

console.time('Application start')

console.time('Imports')

import * as fs from 'fs'
import * as path from 'path'

import { Request, Response } from 'express'
import { dnsCache, Logger } from 'devtube-commons'
import './utils'
import {fastr} from './api/fastr'
import { Videos } from './videos'
import responseTime from './responseTime'


console.timeEnd('Imports')

console.time('Init')

// Configuration settings
Logger.enabled = true

// Configure DNS cache
dnsCache()

// Configure Express application dependencies
let express = require('express')
let body = require('body-parser')
let mustache = require('mustache-express')
let cors = require('cors')

let app = express()
let devMode = process.env.DEV_MODE === 'true' || process.argv[2] === 'dev'
let staticDir = devMode ? '../dist' : './dist'
let port = process.env.PORT || 8100


app.use(cors())
app.use(responseTime)
app.use(body.json())
app.use(express.static(staticDir, {
  index: false
}))

app.engine('html', mustache())

app.set('port', port)
app.set('view engine', 'mustache')
app.set('view cache', !devMode)
app.set('views', path.join(__dirname, staticDir))

console.timeEnd('Init')

Logger.info('---- APPLICATION STARTED ----')

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Application logic
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

let featuredOrUndefined = () => {
  let tags = fastr.listTags()
  let channels = fastr.listChannels()
  let speakers = fastr.listSpeakers()
  return JSON.stringify({
    tags: tags,
    channels: channels,
    speakers: speakers
  })
}

console.timeEnd('Application start')

async function proxy(req: Request, res: Response) {

  let directLink = ['/channel/', '/tag/'].find(it => req.path.startsWith(it))

  let cookies = req.get('Cookie')
  let nightMode = cookies && cookies.includes("nightMode")

  Logger.info(`REQUEST PATH: ${req.path}`)

  let indexHtml = (res, overrides = {} as any) => {
    let title = overrides.title || 'DevTube - The best developer videos in one place'
    let description = overrides.description || 'Enjoy the best tech conference videos, webinars and tutorials and share it with friends, colleagues, and the world.'
    let ogImage = overrides.ogImage || 'https://dev.tube/open_graph.jpg'

    let defaultResponse = {
      title: title,
      nightMode: nightMode,
      featured: featuredOrUndefined(),
      meta: [
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:image", content: ogImage },
        { property: 'twitter:title', content: title },
        { property: 'twitter:description', content: description },
        { property: 'twitter:image', content: ogImage },
        { property: 'twitter:card', content: 'summary_large_image' },
        { property: 'twitter:site', content: '@WatchDevTube' },
        { property: 'twitter:creator', content: '@WatchDevTube' }
      ]
    }
    res.render('index.html', { ...defaultResponse, ...overrides })
  }

  if (!req.path || req.path == "/" || req.path == '/find' ) {
    indexHtml(res)
  } else if (req.path.startsWith("/contributors")) {
    indexHtml(res, {
      title: 'DevTube – Community and Contributors',
      board: fs.readFileSync(`${__dirname}/data/board.json`, 'utf8')
    })
  } else if (req.path.startsWith("/@")) {
    let speaker = req.path.split("/@")[1]
    let avatarUrl = Buffer.from(`http://avatars.io/twitter/${speaker}`).toString('base64')
    let image = `https://res.cloudinary.com/eduardsi/image/upload/l_fetch:${avatarUrl},w_180,h_180,g_south_west,x_650,y_270,r_max,bo_2px_solid_white/e_colorize,co_white,l_text:Lato_35:@${speaker.toUpperCase()},g_south_west,x_220,y_307/dazzle_xcifcf.png`
    Logger.info(`SPEAKER REQUEST: ${speaker}`)
    indexHtml(res, {
      title: `DevTube - Videos by @${speaker}`,
      speaker: `"${speaker}"`,
      ogImage: image
    })
  } else if (req.path.startsWith("/api")) {
    let module = await import(`./${req.path}`)
    module.default(req, res)
  } else if (directLink) {
    let param = req.path.split(directLink)[1]
    Logger.info(`DIRECT LINK REQUEST: ${directLink}`)
    
    indexHtml(res, {
      title: `DevTube - Videos, tutorials, webinars about ${param}`
    })   
  } else if (req.path.startsWith('/video/')) {

    let objectID = req.path.split('/')[2]
    
    Logger.info(`VIDEO REQUEST: ${objectID}`)
    
    let q = undefined
    let sortOrder = '-satisfaction'
    let refinement = { 'objectID' : objectID } 

    let videoId = fastr.search(q, refinement, sortOrder)
      .filter(hit => hit != null)
      .map(it => it.objectID)
      .find(it => true)

    let [video] = await new Videos([videoId]).fetch()

    if (!video) {
      res.status(404).send('Not found')
    } else {
      let ogImage = `https://img.youtube.com/vi/${video.objectID}/maxresdefault.jpg`
      let title = `${video.title} – Watch @ Dev.Tube`
      indexHtml(res, {
        title: title,
        description: video.description,
        ogImage: ogImage,
        preloadedEntity: JSON.stringify(video)
      })
    }
  } else {
    if (fs.existsSync('.' + req.path)) {
      res.sendFile('.' + req.path)
    } else {
      res.status(404).send('not found')
    }
  }
}

app.get("*", proxy)
app.post("*", proxy)

if (devMode) {
  let listener = app.listen(port, () => {
    console.log('Your app is listening on port ' + listener.address().port)
  })
}

module.exports = app
