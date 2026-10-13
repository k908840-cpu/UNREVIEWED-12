# Audio provenance and licensing

UNREVIEWED bundles one third-party background-music track and generates its
sound effects locally with Web Audio synthesis in `src/lib/sound.js`.

| Item | Source | Author | Licence / commercial use | Attribution |
| --- | --- | --- | --- | --- |
| Background music | [Local Forecast – Slower](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1300011) | Kevin MacLeod | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); commercial use, redistribution, and adaptation are permitted with attribution. | `"Local Forecast – Slower" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License https://creativecommons.org/licenses/by/4.0/` |
| Sound effects | N/A — generated from repository source code | UNREVIEWED project contributors | Original project work; it may be modified, redistributed, and included with the UNREVIEWED Android application under the project's distribution terms. | None required. |

The bundled file is `src/assets/audio/local-forecast-slower.mp3`. It is the
selected, unmodified track (SHA-256
`8214CE19DE17D6EDFE4B83A156FEB321D814278DEB582FDD5209DCB47F56D440`). Any
future sampled track must be added here with its direct source URL, author,
licence text, and attribution requirement before it is included in a release.
