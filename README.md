## Installation

```
npm install --save-dev @diram1x/nmtools
```

## Build Outputs

| Client                                           | Build Command          | Formats         |
| ------------------------------------------------ | ---------------------- | --------------- |
| **[Next Music](https://nm.diram1x.ru/)**         | `nmtools build nextmusic` | `.tar.gz`       |
| **[PulseSync](https://pulsesync.dev/)**          | `nmtools build pulsesync` | `.zip`, `.pext` |
| **[Yandex Music Web](https://music.yandex.ru/)** | `nmtools build web`       | `.user.js`      |
| **Module**                                       | `nmtools build bin`       | `.bin`          |

### Naming

```id="b9r9fi"
${theme.name}_${theme.version}_${build.package}.ext
```

- `theme.name` - theme name
- `theme.version` - version
- `build.package` - target

### Web Features

- **icon** - Tampermonkey icon
- **userscript** - bundles into a single `.user.js`
- **replaceLink**:
  - `from` → embeds asset into CSS
  - `from` + `to` → replaces URL

### Output Example

```id="9rpqdb"
dist/
├── Example-Theme_1.0.0_nm.tar.gz
├── Example-Theme_1.0.0_ps.zip
├── Example-Theme_1.0.0_ps.pext
└── Example-Theme_1.0.0_web.user.js
```

### package.json Example

```
{
    "name": "example-theme",
    "addonName" "Example Theme!",
    "version": "1.0.0",
    "description": "Example description",
    "author": "Your name",
    "license": "Your Project License",
    "scripts": {
        "build": "nmtools build",
        "build:nextmusic": "nmtools build nextmusic",
        "build:pulsesync": "nmtools build pulsesync",
        "build:web": "nmtools build web"
    },
    "build": {
        "targets": [
            "nextmusic",
            "pulsesync",
            "web"
        ]
    },
    "nextmusic": {
        "tarGz": {
            "artifactName": "Example-Theme_${theme.version}_${build.package}.tar.gz"
        }
    },
    "pulsesync": {
        "zip": {
            "artifactName": "Example-Theme_${theme.version}_${build.package}.zip"
        },
        "pext": {
            "artifactName": "Example-Theme_${theme.version}_${build.package}.pext"
        }
    },
    "web": {
        "icon": "https://url/to/icon.ext",
        "userscript": {
            "artifactName": "Example-Theme_${theme.version}_${build.package}.user.js"
        },
        "replaceLink": [
            {
                "from": "http://127.0.0.1:2007/assets/vibe.jpg?name=Example Theme!" // Embeds asset into CSS
            },
            {
                "from": "http://127.0.0.1:2007/assets/uzi.png?name=Example Theme!",             // Replaces
                "to": "https://github.com/Diramix/Diramix/blob/main/assets/banner.png?raw=true" // URL
            }
        ]
    },
    "devDependencies": {
        "@diram1x/nmtools": "^4.2.0"
    }
}
```
