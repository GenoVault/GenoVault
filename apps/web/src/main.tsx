import './index.css'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App.tsx'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Failed to find the root element')

/**
 * Роутер мусить знати той самий базовий шлях, що й збірка.
 *
 * `BASE_URL` Vite віддає зі слешем у кінці (`/GenoVault/`), а `basename`
 * React Router чекає без нього (`/GenoVault`); корінь лишається коренем.
 * Без цього на GitHub Pages кожен маршрут читався б як `/GenoVault/datasets`
 * проти оголошеного `/datasets` і падав би на сторінку «не знайдено».
 */
const basename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/'

createRoot(rootElement).render(
  <BrowserRouter basename={basename}>
    <App />
  </BrowserRouter>,
)
