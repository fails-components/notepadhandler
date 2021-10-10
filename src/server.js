/*
    Fails Components (Fancy Automated Internet Lecture System - Components)
    Copyright (C)  2015-2017 (original FAILS), 
                   2021- (FAILS Components)  Marten Richter <marten.richter@freenet.de>

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as
    published by the Free Software Foundation, either version 3 of the
    License, or (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { createServer } from 'http'
import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import * as redis from 'redis'
import MongoClient from 'mongodb'
import { NoteScreenConnection } from './notepadhandler.js'
import {
  FailsJWTSigner,
  FailsJWTVerifier,
  FailsAssets
} from '@fails-components/security'
import { FailsConfig } from '@fails-components/config'

const initServer = async () => {
  const cfg = new FailsConfig()

  const redisclient = redis.createClient(cfg.redisPort(), cfg.redisHost(), {
    detect_buffers: true /* required by notescreen connection */,
    password: cfg.redisPass()
  })

  const redisclpub = redisclient.duplicate()
  const redisclsub = redisclient.duplicate()

  const mongoclient = await MongoClient.connect(cfg.getMongoURL(), {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  const mongodb = mongoclient.db(cfg.getMongoDB())

  const server = createServer()

  const assets = new FailsAssets({
    datadir: cfg.getDataDir(),
    dataurl: cfg.getURL('data'),
    webservertype: cfg.getWSType(),
    privateKey: cfg.getStatSecret()
  })

  const lecturesecurity = new FailsJWTSigner({
    redis: redisclient,
    type: 'lecture',
    expiresIn: '10m',
    secret: cfg.getKeysSecret()
  })
  const screensecurity = new FailsJWTSigner({
    redis: redisclient,
    type: 'screen',
    expiresIn: '10m',
    secret: cfg.getKeysSecret()
  })
  const lectureverifier = new FailsJWTVerifier({
    redis: redisclient,
    type: 'lecture'
  })
  const screenverifier = new FailsJWTVerifier({
    redis: redisclient,
    type: 'screen'
  })

  // may be move the io also inside the object, on the other hand, I can not insert middleware anymore

  let cors = null

  if (cfg.needCors()) {
    cors = {
      origin: cfg.getURL('web'),
      methods: ['GET', 'POST']
      // credentials: true
    }
  }

  const ioIns = new Server(server, {
    cors: cors,
    path: '/notepad.io',
    serveClient: false
  })

  const notepadio = ioIns.of('/notepads')
  const screenio = ioIns.of('/screens')
  const notesio = ioIns.of('/notes')

  ioIns.adapter(createAdapter(redisclpub, redisclsub))

  const nsconn = new NoteScreenConnection({
    redis: redisclient,
    mongo: mongodb,
    notepadio: notepadio,
    screenio: screenio,
    notesio: notesio,
    signScreenJwt: screensecurity.signToken,
    signNotepadJwt: lecturesecurity.signToken,
    getFileURL: assets.getFileURL,
    notepadhandlerURL: cfg.getURL('notepad'),
    screenUrl: cfg.getURL('web'),
    notepadUrl: cfg.getURL('web'),
    notesUrl: cfg.getURL('web')
  })

  notepadio.use(lectureverifier.socketauthorize())
  notepadio.on('connection', (socket) => {
    nsconn.SocketHandlerNotepad.bind(nsconn, socket)()
  })
  screenio.use(screenverifier.socketauthorize())
  screenio.on('connection', (socket) => {
    nsconn.SocketHandlerScreen.bind(nsconn, socket)()
  })

  notesio.use((socket, next) => {
    return next(new Error('no Connection possible'))
  }) // this should not connect to notes

  let port = cfg.getPort('notepad')
  if (port === 443) port = 8080 // we are in production mode inside a container

  server.listen(port, cfg.getHost(), function () {
    console.log(
      'Failsserver listening at http://%s:%s',
      server.address().address,
      server.address().port
    )
  })
}
initServer()
