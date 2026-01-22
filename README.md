# Calendrier ICS

Agrégateur de calendriers ICS simple et léger.

## Fonctionnalités

- Agrège plusieurs sources ICS (Google Calendar, etc.)
- Interface web avec filtres par source
- Proxy ICS pour s'abonner via l'app
- Rafraîchissement automatique configurable
- Scroll infini
- Sans base de données (stateless)

## Installation

```bash
npm install
cp config.example.yaml config.yaml
# Editer config.yaml avec vos URLs ICS
npm start
```

## Configuration

Copier `config.example.yaml` vers `config.yaml` et modifier :

```yaml
title: "Mon Calendrier"      # Titre de la page
refreshInterval: 15          # Rafraîchissement (minutes)
port: 3000                   # Port du serveur

sources:
  - id: perso                # Identifiant unique
    name: "Personnel"        # Nom affiché
    url: "https://..."       # URL ICS (secrète)
    color: "#4285f4"         # Couleur
    enabled: true            # Activer/désactiver
```

### Obtenir l'URL ICS Google Calendar

1. Google Calendar > Paramètres (roue dentée)
2. Cliquer sur le calendrier souhaité
3. Section "Adresse secrète au format iCal"
4. Copier l'URL

## Docker

```bash
# Build
docker build -t calendrier .

# Run
docker run -p 3000:3000 -v $(pwd)/config.yaml:/app/config.yaml calendrier
```

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/sources` | Liste des sources |
| `GET /api/events` | Liste des événements |
| `GET /api/config` | Configuration |
| `POST /api/refresh` | Forcer le rafraîchissement |
| `GET /ics/:id.ics` | Proxy ICS par source |
| `GET /ics/all.ics` | Tous les calendriers combinés |

## License

MIT
