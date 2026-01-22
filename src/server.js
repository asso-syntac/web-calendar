const express = require('express');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const ical = require('node-ical');

const app = express();

// Load configuration
const configPath = process.env.CONFIG_PATH || path.join(__dirname, '..', 'config.yaml');
let config;

try {
  config = yaml.load(fs.readFileSync(configPath, 'utf8'));
  console.log(`Configuration loaded from ${configPath}`);
} catch (e) {
  console.error('Error loading config:', e.message);
  process.exit(1);
}

// In-memory cache for events and raw ICS data
let eventsCache = new Map();
let icsCache = new Map();
let lastRefresh = null;

// Parse ICS data and extract events
function parseICS(icsData, sourceId, sourceName, color) {
  const events = [];
  
  try {
    const parsed = ical.sync.parseICS(icsData);
    
    for (const key in parsed) {
      const event = parsed[key];
      
      // Only process VEVENT types
      if (event.type !== 'VEVENT') continue;
      if (!event.start) continue;
      
      const startDate = event.start instanceof Date ? event.start : new Date(event.start);
      const endDate = event.end ? (event.end instanceof Date ? event.end : new Date(event.end)) : null;
      
      // Check if it's an all-day event (date only, no time)
      const allDay = event.start.dateOnly === true || 
                     (event.start.length === 10) || 
                     (typeof event.start === 'object' && !event.start.getHours);
      
      events.push({
        id: event.uid || `${sourceId}-${Date.now()}-${Math.random()}`,
        title: event.summary || 'Sans titre',
        description: event.description || '',
        location: event.location || '',
        start: startDate.toISOString(),
        end: endDate ? endDate.toISOString() : null,
        allDay: !!allDay,
        sourceId,
        sourceName,
        color
      });
    }
  } catch (e) {
    console.error(`Error parsing ICS for ${sourceName}:`, e.message);
  }
  
  return events;
}

// Fetch events from a single source
async function fetchSource(source) {
  console.log(`Fetching: ${source.name}...`);
  
  try {
    const response = await fetch(source.url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const icsData = await response.text();
    
    // Check if we got HTML instead of ICS (auth redirect)
    if (icsData.trim().startsWith('<!') || icsData.trim().startsWith('<html')) {
      throw new Error('Received HTML instead of ICS - calendar may be private. Use the secret iCal URL.');
    }
    
    const events = parseICS(icsData, source.id, source.name, source.color);
    
    console.log(`  -> ${events.length} events from ${source.name}`);
    return { events, icsData };
  } catch (e) {
    console.error(`  -> Error fetching ${source.name}:`, e.message);
    return { events: [], icsData: null };
  }
}

// Refresh all sources
async function refreshAllSources() {
  console.log('\n--- Refreshing all sources ---');
  
  const newEventsCache = new Map();
  const newIcsCache = new Map();
  
  for (const source of config.sources) {
    if (source.enabled !== false) {
      const { events, icsData } = await fetchSource(source);
      newEventsCache.set(source.id, events);
      if (icsData) {
        newIcsCache.set(source.id, icsData);
      }
    }
  }
  
  eventsCache = newEventsCache;
  icsCache = newIcsCache;
  lastRefresh = new Date();
  
  console.log(`--- Refresh complete at ${lastRefresh.toISOString()} ---\n`);
}

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// API: Get sources list
app.get('/api/sources', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  
  const sources = config.sources.map(s => ({
    id: s.id,
    name: s.name,
    color: s.color,
    enabled: s.enabled !== false,
    icsUrl: `${baseUrl}/ics/${s.id}.ics`
  }));
  
  res.json({ 
    sources,
    combinedIcsUrl: `${baseUrl}/ics/all.ics`
  });
});

// API: Get all events
app.get('/api/events', (req, res) => {
  const sourceIds = req.query.sources ? req.query.sources.split(',') : null;
  
  let allEvents = [];
  
  for (const [sourceId, events] of eventsCache) {
    if (!sourceIds || sourceIds.includes(sourceId)) {
      allEvents = allEvents.concat(events);
    }
  }
  
  // Sort by start date
  allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
  
  res.json({
    events: allEvents,
    lastRefresh: lastRefresh ? lastRefresh.toISOString() : null
  });
});

// API: Force refresh
app.post('/api/refresh', async (req, res) => {
  await refreshAllSources();
  res.json({ success: true, lastRefresh: lastRefresh.toISOString() });
});

// API: Get config info
app.get('/api/config', (req, res) => {
  res.json({
    title: config.title || 'Calendrier',
    refreshInterval: config.refreshInterval || 15,
    lastRefresh: lastRefresh ? lastRefresh.toISOString() : null
  });
});

// ICS Proxy: Get individual calendar
app.get('/ics/:sourceId.ics', (req, res) => {
  const { sourceId } = req.params;
  const icsData = icsCache.get(sourceId);
  
  if (!icsData) {
    return res.status(404).send('Calendar not found');
  }
  
  const source = config.sources.find(s => s.id === sourceId);
  const filename = source ? source.name.replace(/[^a-z0-9]/gi, '_') : sourceId;
  
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${filename}.ics"`);
  res.send(icsData);
});

// ICS Proxy: Get combined calendar (all sources)
app.get('/ics/all.ics', (req, res) => {
  // Build a combined ICS file
  let combined = 'BEGIN:VCALENDAR\r\n';
  combined += 'VERSION:2.0\r\n';
  combined += 'PRODID:-//Calendrier ICS Aggregator//FR\r\n';
  combined += 'X-WR-CALNAME:Tous les calendriers\r\n';
  
  for (const [sourceId, icsData] of icsCache) {
    // Extract VEVENT blocks from each ICS
    const lines = icsData.split(/\r?\n/);
    let inEvent = false;
    
    for (const line of lines) {
      if (line.startsWith('BEGIN:VEVENT')) {
        inEvent = true;
      }
      if (inEvent) {
        combined += line + '\r\n';
      }
      if (line.startsWith('END:VEVENT')) {
        inEvent = false;
      }
    }
  }
  
  combined += 'END:VCALENDAR\r\n';
  
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="all.ics"');
  res.send(combined);
});

// Start server
const PORT = config.port || process.env.PORT || 3000;

async function start() {
  // Initial fetch
  await refreshAllSources();
  
  // Schedule periodic refresh
  const intervalMs = (config.refreshInterval || 15) * 60 * 1000;
  setInterval(refreshAllSources, intervalMs);
  console.log(`Auto-refresh every ${config.refreshInterval || 15} minutes`);
  
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start();
