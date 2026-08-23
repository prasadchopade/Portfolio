# Portfolio

Personal portfolio site for Prasad Chopade. One page, six plates: cover,
profile, projects, publications, skills, contact.

Static HTML, CSS and vanilla JavaScript. No build step, no dependencies.
Open `index.html` directly, or serve the folder:

```bash
python -m http.server 4173
```

## Layout

| Path | What it holds |
| --- | --- |
| `index.html` | Content spine. Fully readable with JavaScript disabled. |
| `assets/css/portfolio.css` | Design tokens, plate layouts, responsive and print styles. |
| `assets/js/portfolio.js` | Dust field, project marquee, plate navigation. |
| `assets/img/` | Images. |

## Notes

Dark theme by default. Setting `data-theme="light"` on `<html>` switches it.

Motion is optional. Under `prefers-reduced-motion` the animation loop never
starts, the project rail becomes a plain scroll region, and the accent glow
is dropped.

Keyboard: press `0` to `5` to jump between plates.
