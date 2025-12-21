/* eslint-disable node/no-callback-literal */
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

import {
  NetworkSource,
  Dispatcher,
  Collection,
  /*  MemContainer, */
  CallbackContainer
} from '@fails-components/data'
import { v4 as uuidv4, validate as isUUID } from 'uuid'
import { promisify } from 'util'
import Redlock from 'redlock'
import { randomBytes, createHash } from 'crypto'
import { RedisRedlockProxy } from '@fails-components/security'
import { WatchError } from 'redis'
import { CommonConnection } from './commonhandler.js'

export class NoteScreenConnection extends CommonConnection {
  constructor(args) {
    super(args)
    this.redis = args.redis
    this.mongo = args.mongo
    this.notepadio = args.notepadio
    this.screenio = args.screenio
    this.notesio = args.notesio
    this.getFileURL = args.getFileURL
    this.saveFile = args.saveFile

    this.signScreenJwt = args.signScreenJwt
    this.signNotepadJwt = args.signNotepadJwt
    this.signAvsJwt = args.signAvsJwt

    this.screenUrl = args.screenUrl
    this.notepadUrl = args.notepadUrl

    this.notepadhandlerURL = args.notepadhandlerURL

    this.redlock = new Redlock([RedisRedlockProxy(this.redis)], {
      driftFactor: 0.01, // multiplied by lock ttl to determine drift time

      retryCount: 10,

      retryDelay: 200, // time in ms
      retryJitter: 200 // time in ms
    })

    this.SocketHandlerNotepad = this.SocketHandlerNotepad.bind(this)
    this.SocketHandlerScreen = this.SocketHandlerScreen.bind(this)
    this.emitscreenlists = this.emitscreenlists.bind(this)

    this.lastaccess = this.lastaccess.bind(this)
  }

  lastaccess(uuid) {
    // TODO
    // console.log('lastaccess', uuid)
  }

  async emitscreenlists(args) {
    // only lectureuuid
    const roomname = this.getRoomName(args.lectureuuid)

    const presinfo = this.getPresentationinfo(args)

    const screens = this.getNoteScreens(args)

    const channelinfo = this.getChannelNoteScreens(args)

    const readypresinfo = await presinfo

    const readyscreens = await screens

    // console.log('avil notepadscreens', args.notescreenuuid, readyscreens)
    this.notepadio.to(roomname).emit('availscreens', { screens: readyscreens })
    this.screenio.to(roomname).emit('availscreens', { screens: readyscreens })
    this.notesio.to(roomname).emit('presinfo', readypresinfo)
    const readychannels = await channelinfo
    // console.log('channelinfo', readychannels)

    this.notepadio.to(roomname).emit('channelinfo', readychannels)
    this.screenio.to(roomname).emit('channelinfo', readychannels)

    /* this.getNoteScreens(args, (res) => {
      console.log("notepadscreens",args.notescreenuuid, res);
      
      
    }); */
  }

  // fullnotepad lifecycle
  async SocketHandlerNotepad(socket) {
    const address = socket.handshake.headers['x-forwarded-for']
      .split(',')
      .map((el) => el.trim()) || [socket.client.conn.remoteAddress]
    console.log('Client %s with ip %s  connected', socket.id, address)
    if (socket.decoded_token)
      console.log('Client username', socket.decoded_token.user.displayname)
    else console.log('no decoded token')

    // console.log('decoded token', socket.decoded_token)

    if (!isUUID(socket.decoded_token.lectureuuid)) {
      console.log('lectureuuid in decoded token invalid')
    }

    const notepadscreenid = {
      lectureuuid: socket.decoded_token.lectureuuid,
      socketid: socket.id,
      notescreenuuid: socket.decoded_token.notescreenuuid,
      purpose: 'notepad',
      appversion: socket.decoded_token.appversion,
      features: socket.decoded_token.features,
      user: socket.decoded_token.user,
      name: socket.decoded_token.name,
      displayname: socket.decoded_token.user.displayname,
      screensharechannelid: undefined
    }
    this.cleanupNotescreens(notepadscreenid) // Cleanup
    // TODO
    /* this.getNoteScreens(notepadscreenid, ((screens)=>{
     socket.emit('availscreens',{screens: screens });
      })); */
    const loadlectprom = this.loadLectFromDB(notepadscreenid.lectureuuid)

    let curtoken = socket.decoded_token
    let routerres
    let routerurl = new Promise((resolve) => {
      routerres = resolve
    })

    // setup data for handling the connection

    const collection = new Collection(
      function (id, data) {
        return new CallbackContainer(id, data)
      },
      {
        writeData: async (obj, number, data, append) => {
          await loadlectprom
          obj.writeData(notepadscreenid.lectureuuid, number, data, append)
        },
        obj: this
      }
    )
    const dispatcher = new Dispatcher() // dispatcher adds time stamps
    dispatcher.addSink(collection)

    const networksource = new NetworkSource(dispatcher)

    // should be handled by client, really
    /*
    this.redis.get(
      Buffer.from('lecture:' + notepadscreenid.lectureuuid + ':boardcommand'),
      function (err, res) {
        if (err) console.log('get board command', err)
        else if (res) {
          const memcont = new MemContainer('command', {})
          /* var ab = new ArrayBuffer(res.length);
        var view = new Uint8Array(ab);
        for (var i = 0; i < res.length; i++) {
          view[i] = res[i];
        } *
          const ab = res

          memcont.replaceStoredData(ab)
          const cs = memcont.getCurCommandState()
          // console.log('cs state', cs)
          dispatcher.setTimeandScrollPos(cs.time, cs.scrollx, cs.scrolly)
          if (socket) {
            socket.emit('drawcommand', {
              task: 'scrollBoard',
              time: dispatcher.getTime(),
              x: dispatcher.scrollx,
              y: dispatcher.scrolly,
              timeSet: true
            })
          }
        }
      }
    )
    */
    /* if (notepadscreenid) {
       //notepadscreen.socket=socket;
       //notepadscreen.lecture.failsdata=true; // we have started giving a lecture
       /*var lectures=terms.getCourseLectures(cmd.termuuid,cmd.courseuuid
                 ,socket.decoded_token.authinfo);
       if (lectures) lectures.saveDB();*
       
     } */

    this.connectNotescreen(notepadscreenid)
    notepadscreenid.roomname = this.getRoomName(notepadscreenid.lectureuuid)
    console.log('notepad connected, join room', notepadscreenid.roomname)
    if (notepadscreenid.roomname) socket.join(notepadscreenid.roomname)

    {
      const messagehash = createHash('sha256')
      const useruuid = socket.decoded_token.user.useruuid
      // now we create a hash that can be used to identify a user, if and only if,
      // access to this database is available and not between lectures!
      messagehash.update(useruuid + notepadscreenid.lectureuuid)
      notepadscreenid.userhash = messagehash.digest('hex')
    }

    const emittoken = async () => {
      const token = await this.getLectureToken(curtoken)
      curtoken = token.decoded
      socket.emit('authtoken', { token: token.token })
    }
    emittoken().catch((error) => {
      console.log('notepad emittoken problem', error)
    })
    socket.emit('userhash', notepadscreenid.userhash)
    this.emitCryptoIdent(socket, notepadscreenid)
    this.emitAVOffers(socket, notepadscreenid)
    this.emitVideoquestions(socket, notepadscreenid)

    socket.on('reauthor', async () => {
      // we use the information from the already present authtoken
      const token = await this.getLectureToken(curtoken)
      curtoken = token.decoded
      this.updateNotescreenActive(notepadscreenid)
      socket.emit('authtoken', { token: token.token })
    })

    socket.on('getrouting', async (cmd, callback) => {
      if (cmd && cmd.id && cmd.dir && (cmd.dir === 'in' || cmd.dir === 'out')) {
        try {
          let toid
          await Promise.any([
            routerurl,
            new Promise((resolve, reject) => {
              toid = setTimeout(reject, 20 * 1000)
            })
          ])
          if (toid) clearTimeout(toid)
          toid = undefined
          await this.getRouting(notepadscreenid, cmd, await routerurl, callback)
        } catch (error) {
          callback({ error: 'getrouting: timeout or error: ' + error })
        }
      } else callback({ error: 'getrouting: malformed request' })
    })

    socket.on('gettransportinfo', (cmd, callback) => {
      let geopos
      if (cmd && cmd.geopos && cmd.geopos.longitude && cmd.geopos.latitude)
        geopos = {
          longitude: cmd.geopos.longitude,
          latitude: cmd.geopos.latitude
        }
      this.getTransportInfo(
        {
          ipaddress: address,
          geopos,
          lectureuuid: notepadscreenid.lectureuuid,
          clientid: socket.id,
          canWrite: true
        },
        (ret) => {
          if (ret.url) {
            if (routerres) {
              const res = routerres
              routerres = undefined
              res(ret.url)
            }
            routerurl = ret.url
          } else routerurl = undefined
          callback(ret)
        }
      ).catch((error) => {
        console.log('Problem in getTransportInfo', error)
      })
    })

    socket.on('keyInfo', (cmd) => {
      if (cmd.cryptKey && cmd.signKey) {
        notepadscreenid.cryptKey = cmd.cryptKey
        notepadscreenid.signKey = cmd.signKey
        this.addUpdateCryptoIdent(notepadscreenid)
      }
    })

    socket.on('keymasterQuery', () => {
      this.handleKeymasterQuery(notepadscreenid)
    })

    socket.on('keymasterQueryResponse', (data) => {
      this.handleKeymasterQueryResponse(notepadscreenid, data, socket)
    })

    socket.on('getKeyNum', async (callback) => {
      try {
        const keynum = await this.redis.hIncrBy(
          'lecture:' + notepadscreenid.lectureuuid + ':keymaster',
          'keynum',
          '1'
        )
        callback({ keynum })
      } catch (error) {
        console.log('getKeyNum failed', error)
        callback({ error: error })
      }
    })

    socket.on('sendKey', async (data) => {
      if (data.message && data.dest) {
        try {
          const dest = data.dest
          const exists = await this.redis.hExists(
            'lecture:' + notepadscreenid.lectureuuid + ':idents',
            dest
          )
          // on check if the identity is inside our lecture, otherwise an attacker may be able to break out context
          if (exists) {
            const tosend = {
              message: data.message,
              signature: data.signature,
              id: socket.id
            }
            if (data.purpose === 'notes') {
              this.notesio.to(dest).emit('receiveKey', tosend)
            } else if (
              data.purpose === 'notepad' ||
              data.purpose === 'lecture'
            ) {
              this.notepadio.to(dest).emit('receiveKey', tosend)
            } else if (data.purpose === 'screen') {
              this.screenio.to(dest).emit('receiveKey', tosend)
            }
          } else {
            console.log('Attempt to sendKey outside realm')
          }
        } catch (error) {
          console.log('sendKey error', error)
        }
      }
    })

    socket.on('avoffer', (cmd) => {
      this.handleAVoffer(notepadscreenid, cmd).catch((error) => {
        console.log('Problem in handleAVoffer', error)
      })
    })

    socket.on('allowvideoquestion', (cmd) => {
      this.allowVideoQuestion(notepadscreenid, cmd).catch((error) => {
        console.log('Problem in allowVideoQuestion', error)
      })
    })

    socket.on('closevideoquestion', (cmd) => {
      this.closeVideoQuestion(notepadscreenid, cmd).catch((error) => {
        console.log('Problem in closeVideoQuestion', error)
      })
    })

    socket.on('chatquestion', (cmd) => {
      if (cmd.text) {
        const displayname = socket.decoded_token.user.displayname

        this.notesio.to(notepadscreenid.roomname).emit('chatquestion', {
          displayname: displayname,
          text: cmd.text,
          encData: cmd.encData,
          keyindex: cmd.keyindex,
          iv: cmd.iv,
          resend: !!cmd.resend,
          showSendername: !!cmd.showSendername
        })
      }
    })

    socket.on('sendboards', async (cmd) => {
      await loadlectprom
      // console.log('notepad connected, send board data')
      this.sendBoardsToSocket(notepadscreenid.lectureuuid, socket)
      /* socket.emit('drawcommand', {
          task: 'scrollBoard',
          time: dispatcher.getTime(),
          x: dispatcher.scrollx,
          y: dispatcher.scrolly,
          timeSet: true
        }) */
    })

    socket.on('createscreen', async (callback) => {
      // ok we create the credentials for a new screen
      const token = await this.createScreenForLecture(
        notepadscreenid,
        curtoken.maxrenew
      ) // res contains token
      callback({
        token: token,
        screenurl: this.screenUrl[notepadscreenid.appversion]
      })
    })

    socket.on('createnotepad', async (callback) => {
      // ok we create the credentials for a new screen
      const token = await this.createNotepadForLecture(
        notepadscreenid,
        curtoken.maxrenew
      ) // res contains token
      callback({
        token: token,
        notepadurl: this.notepadUrl[notepadscreenid.appversion]
      })
    })

    socket.on('createchannel', () => {
      // console.log('createchannel')
      this.addNewChannel(
        notepadscreenid,
        'notebooks',
        true /* emitscreenlist */
      )
    })

    socket.on('updatesizes', async (cmd) => {
      await loadlectprom
      // console.log('peek updatesizes', cmd)

      this.setLectureProperties(
        notepadscreenid,
        cmd.casttoscreens !== undefined
          ? cmd.casttoscreens === true
          : undefined,
        cmd.backgroundbw !== undefined ? cmd.backgroundbw === true : undefined,
        cmd.showscreennumber !== undefined
          ? cmd.showscreennumber === true
          : undefined
      )

      this.updateNoteScreen(notepadscreenid, cmd.scrollheight, 'notepad')

      // if (notepadscreenid.roomname) this.emitscreenlists(args); // update Notescreen should do this
    })

    socket.on('getAvailablePicts', async (callback) => {
      const pictinfo = await this.getAvailablePicts(notepadscreenid)
      callback(pictinfo)
    })

    socket.on('getAvailableIpynbs', async (callback) => {
      const ipynbinfo = await this.getAvailableIpynbs(notepadscreenid)
      callback(ipynbinfo)
    })

    socket.on('getPolls', async (callback) => {
      const polls = await this.getPolls(notepadscreenid)
      callback(polls)
    })

    socket.on('startPoll', (cmd) => {
      if (
        !(
          cmd.poll &&
          cmd.poll.children &&
          cmd.poll.children.length &&
          cmd.poll.name &&
          /^[0-9a-zA-Z]{9}$/.test(cmd.poll.id)
        )
      ) {
        console.log('received corrupt poll', cmd.poll)
        return
      }
      const poll = cmd.poll
      const limited = !!cmd.limited
      let participants
      if (typeof cmd.participants !== 'undefined') {
        if (!Array.isArray(cmd.participants)) {
          console.log('poll participants is not an array')
          return
        }
        console.log('partcipants peak', cmd.participants)
        if (
          cmd.participants.some(
            (el) => typeof el !== 'string' || !/^[0-9a-zA-Z]+$/.test(el)
          )
        ) {
          console.log('poll participant items are not userhash format')
          return
        }
        participants = cmd.participants
      } else {
        if (limited) {
          console.log('poll participants not set in limited poll')
          return
        }
      }

      this.startPoll(notepadscreenid.lectureuuid, {
        poll,
        limited,
        participants
      })
    })

    socket.on('finishPoll', (data) => {
      if (data.pollid && /^[0-9a-zA-Z]{9}$/.test(data.pollid)) {
        this.finishPoll(notepadscreenid.lectureuuid, data)
      } else {
        console.log('received corrupt finish poll', data.pollid)
      }
    })

    socket.on('switchAppMaster', async (cmd) => {
      const masterCommand = { appletMaster: socket.id }
      this.notepadio
        .to(notepadscreenid.roomname)
        .emit('switchAppMaster', masterCommand)
      this.screenio
        .to(notepadscreenid.roomname)
        .emit('switchAppMaster', masterCommand)
      this.notesio
        .to(notepadscreenid.roomname)
        .emit('switchAppMaster', masterCommand)
    })

    socket.on(
      'uploadPicture',
      async (name, type, picture, thumbnail, callback) => {
        try {
          if (typeof name !== 'string')
            throw new Error('Type of name is not string')
          if (
            typeof type !== 'string' ||
            !['image/jpeg', 'image/png'].includes(type)
          )
            throw new Error('Type of type is not string')
          if (!Buffer.isBuffer(picture) || !Buffer.isBuffer(thumbnail))
            throw new Error('Picture or thumbnail wrong type')
          const { sha, tsha } = await this.uploadPicture(notepadscreenid, {
            name,
            type,
            picture,
            thumbnail
          })
          callback({ sha, tsha, name })
        } catch (error) {
          console.log('uploadPicture error', error)
          callback({ error, name })
        }
      }
    )

    socket.on('drawcommand', async (cmd) => {
      await loadlectprom
      if (notepadscreenid) {
        networksource.receiveData(cmd)
      }
      // special handling
      if (cmd.task === 'addPicture') {
        if (notepadscreenid) {
          const pictinfo = await this.getPicture(notepadscreenid, cmd.uuid)
          if (pictinfo) {
            this.notepadio
              .to(notepadscreenid.roomname)
              .emit('pictureinfo', pictinfo)
            this.screenio
              .to(notepadscreenid.roomname)
              .emit('pictureinfo', pictinfo)
            this.notesio
              .to(notepadscreenid.roomname)
              .emit('pictureinfo', pictinfo)
          }
        }
      }
      if (cmd.task === 'startApp') {
        const ipynbinfo = await this.getIpynb(notepadscreenid, cmd.id, cmd.sha)
        if (ipynbinfo) {
          const sendinfo = { ipynbs: ipynbinfo, appletMaster: socket.id }
          this.notepadio
            .to(notepadscreenid.roomname)
            .emit('ipynbinfo', sendinfo)
          this.screenio.to(notepadscreenid.roomname).emit('ipynbinfo', sendinfo)
          this.notesio.to(notepadscreenid.roomname).emit('ipynbinfo', sendinfo)
        }
      }
      // generell distribution
      if (notepadscreenid.roomname) {
        this.notepadio.to(notepadscreenid.roomname).emit('drawcommand', cmd)
        this.screenio.to(notepadscreenid.roomname).emit('drawcommand', cmd)
        this.notesio.to(notepadscreenid.roomname).emit('drawcommand', cmd)
      }
    })

    socket.on('FoG', (cmd) => {
      if (notepadscreenid.roomname) {
        this.notepadio.to(notepadscreenid.roomname).emit('FoG', cmd)
        this.screenio.to(notepadscreenid.roomname).emit('FoG', cmd)
        this.notesio.to(notepadscreenid.roomname).emit('FoG', cmd)
      }
    })

    socket.on('addnotescreentochannel', (cmd) => {
      // TODO new concept
      // console.log('check addnotescreen cmd', cmd)
      if (isUUID(cmd.notescreenuuid) && isUUID(cmd.channeluuid)) {
        /* console.log(
            'addnotescreentochannel',
            cmd.notescreenuuid,
            cmd.channeluuid
          ) */
        this.assignNoteScreenToChannel({
          channeluuid: cmd.channeluuid,
          lectureuuid: notepadscreenid.lectureuuid,
          notescreenuuid: cmd.notescreenuuid
        })
      }
    })

    socket.on('removechannel', (cmd) => {
      // console.log('removechannel', cmd)
      if (isUUID(cmd.channeluuid)) {
        // console.log('removechannel request', cmd.channeluuid)
        this.removeChannel(notepadscreenid, cmd.channeluuid)
      }
    })

    socket.on('disconnect', () => {
      console.log('Client %s with ip %s  disconnected', socket.id, address)
      if (notepadscreenid.roomname) {
        socket.leave(notepadscreenid.roomname)
        notepadscreenid.roomname = null
      }
      if (notepadscreenid) {
        // delete  notepadscreen.socket;
        this.disconnectNotescreen(notepadscreenid)
        // notepadscreenid=null;
      }
    })
  }

  async SocketHandlerScreen(socket) {
    const address = socket.handshake.headers['x-forwarded-for']
      .split(',')
      .map((el) => el.trim()) || [socket.client.conn.remoteAddress]
    console.log('Screen %s with ip %s  connected', socket.id, address)
    console.log('Screen name', socket.decoded_token.name)
    console.log('Screen uuid', socket.decoded_token.notescreenuuid)
    console.log('Screen lecture uuid', socket.decoded_token.lectureuuid)

    const purescreen = {
      socketid: socket.id,
      lectureuuid: socket.decoded_token.lectureuuid,
      notescreenuuid: socket.decoded_token.notescreenuuid,
      name: socket.decoded_token.name,
      displayname: socket.decoded_token.user.displayname,
      appversion: socket.decoded_token.appversion,
      features: socket.decoded_token.features,
      purpose: 'screen',
      color: socket.decoded_token.color
    }

    const loadlectprom = this.loadLectFromDB(purescreen.lectureuuid)

    this.connectNotescreen(purescreen)
    // this.addScreen(purescreen);

    let curtoken = socket.decoded_token
    let routerres
    let routerurl = new Promise((resolve) => {
      routerres = resolve
    })

    // console.log('screen connected')

    // bIG TODO
    this.getLectDetail(purescreen, socket)

    // console.log('screen send board data')
    loadlectprom.then(() => {
      this.sendBoardsToSocket(purescreen.lectureuuid, socket)
    })
    purescreen.roomname = this.getRoomName(purescreen.lectureuuid)
    /* console.log(
      'screen is connected to notepad, join room',
      purescreen.roomname
    ) */
    socket.join(purescreen.roomname)
    /* } else {
      console.log("screen unauthorized",socket.screendata);
      return;
    } */
    const emittoken = async () => {
      const token = await this.getScreenToken(curtoken)
      curtoken = token.decoded
      socket.emit('authtoken', { token: token.token })
    }
    emittoken().catch((error) => {
      console.log('notepad emittoken problem', error)
    })

    {
      const messagehash = createHash('sha256')
      const useruuid = socket.decoded_token.user.useruuid
      // now we create a hash that can be used to identify a user, if and only if,
      // access to this database is available and not between lectures!
      messagehash.update(useruuid + purescreen.lectureuuid)
      purescreen.userhash = messagehash.digest('hex')
    }

    this.emitAVOffers(socket, purescreen)
    this.emitVideoquestions(socket, purescreen)

    socket.on('reauthor', async () => {
      // we use the information from the already present authtoken
      const token = await this.getScreenToken(curtoken)
      this.updateNotescreenActive(purescreen)
      curtoken = token.decoded
      socket.emit('authtoken', { token: token.token })
    })

    socket.on('updatesizes', async (cmd) => {
      await loadlectprom
      if (purescreen) {
        this.updateNoteScreen(purescreen, cmd.scrollheight, 'screen')

        /* if (notepadscreen) {
          var info=this.getSendSizes(notepadscreenid);
          if (purescreen.roomname) {
            notepadio.to(purescreen.roomname).emit('updatescreensizes',info);
            screenio.to(purescreen.roomname).emit('updatescreensizes',info);
          }
        } */
        // todo send also to screens
      }
    })

    socket.on('getrouting', async (cmd, callback) => {
      if (
        cmd &&
        cmd.id &&
        cmd.dir &&
        cmd.dir === 'in' /* || cmd.dir === 'out' */ // a screen can only receive
      ) {
        try {
          let toid
          Promise.any([
            routerurl,
            new Promise((resolve, reject) => {
              toid = setTimeout(reject, 20 * 1000)
            })
          ])
          if (toid) clearTimeout(toid)
          toid = undefined
          this.getRouting(purescreen, cmd, await routerurl, callback)
        } catch (error) {
          callback({ error: 'getrouting: timeout or error: ' + error })
        }
      } else callback({ error: 'getrouting: malformed request' })
    })

    socket.on('gettransportinfo', (cmd, callback) => {
      let geopos
      if (cmd && cmd.geopos && cmd.geopos.longitude && cmd.geopos.latitude)
        geopos = {
          longitude: cmd.geopos.longitude,
          latitude: cmd.geopos.latitude
        }
      this.getTransportInfo(
        {
          ipaddress: address,
          geopos,
          lectureuuid: purescreen.lectureuuid,
          clientid: socket.id,
          canWrite: false
        },
        (ret) => {
          if (ret.url) {
            if (routerres) {
              const res = routerres
              routerres = undefined
              res(ret.url)
            }
            routerurl = ret.url
          } else routerurl = undefined
          callback(ret)
        }
      ).catch((error) => {
        console.log('Problem in getTransportInfo', error)
      })
    })

    socket.on('keyInfo', (cmd) => {
      if (cmd.cryptKey && cmd.signKey) {
        purescreen.cryptKey = cmd.cryptKey
        purescreen.signKey = cmd.signKey
        this.addUpdateCryptoIdent(purescreen)
      }
    })

    socket.on('keymasterQuery', () => {
      this.handleKeymasterQuery(purescreen)
    })

    socket.on('disconnect', () => {
      console.log(
        'Screen Client %s with ip %s  disconnected',
        socket.id,
        address
      )
      if (purescreen) {
        if (purescreen.roomname) {
          socket.leave(purescreen.roomname)
          // console.log('screen disconnected leave room', purescreen.roomname)
          purescreen.roomname = null
        }
        /* if (purescreen.socketid) {
          purescreen.socketid = null;
        } */
        // this.updatePurescreen(purescreen);
      }

      this.disconnectNotescreen(purescreen)
    })
  }

  async createScreenForLecture(notepadscreenid, maxrenew) {
    const content = {
      lectureuuid: notepadscreenid.lectureuuid,
      notescreenuuid: uuidv4(),
      purpose: 'screen',
      notepadhandler: this.notepadhandlerURL,
      appversion: notepadscreenid.appversion,
      features: notepadscreenid.features,
      maxrenew: maxrenew,
      name: 'Created from lecture',
      user: notepadscreenid.user
    }
    return await this.signScreenJwt(content)
  }

  async createNotepadForLecture(notepadscreenid, maxrenew) {
    const content = {
      lectureuuid: notepadscreenid.lectureuuid,
      notescreenuuid: uuidv4(),
      purpose: 'lecture',
      name: 'Secondary Notebook',
      user: notepadscreenid.user,
      notepadhandler: this.notepadhandlerURL,
      appversion: notepadscreenid.appversion,
      features: notepadscreenid.features,
      maxrenew: maxrenew
    }
    return await this.signNotepadJwt(content)
  }

  async getScreenToken(oldtoken) {
    const newtoken = {
      user: oldtoken.user,
      lectureuuid: oldtoken.lectureuuid,
      notescreenuuid: oldtoken.notescreenuuid,
      purpose: 'screen', // in case a bug is there, no one should escape the realm
      color: oldtoken.color,
      name: oldtoken.name,
      appversion: oldtoken.appversion,
      features: oldtoken.features,
      notepadhandler: this.notepadhandlerURL,
      maxrenew: oldtoken.maxrenew - 1
    }
    if (!oldtoken.maxrenew || !(oldtoken.maxrenew > 0))
      return { error: 'maxrenew token failed', oldtoken: oldtoken }
    try {
      this.redis.hSet(
        'lecture:' +
          oldtoken.lectureuuid +
          ':notescreen:' +
          oldtoken.notescreenuuid,
        ['active', '1', 'lastaccess', Date.now().toString()]
      )
      this.redis.hSet('lecture:' + oldtoken.lectureuuid, [
        'lastaccess',
        Date.now().toString()
      ])
    } catch (error) {
      console.log('redis problem in getScreenToken', error)
    }
    return { token: await this.signScreenJwt(newtoken), decoded: newtoken }
  }

  async getLectureToken(oldtoken) {
    const newtoken = {
      user: oldtoken.user,
      purpose: 'notepad',
      lectureuuid: oldtoken.lectureuuid,
      notescreenuuid: oldtoken.notescreenuuid,
      notepadhandler: this.notepadhandlerURL,
      appversion: oldtoken.appversion,
      features: oldtoken.features,
      name: oldtoken.name,
      maxrenew: oldtoken.maxrenew - 1
    }
    if (!oldtoken.maxrenew || !(oldtoken.maxrenew > 0))
      return { error: 'maxrenew token failed', oldtoken: oldtoken }
    try {
      this.redis.hSet(
        'lecture:' +
          oldtoken.lectureuuid +
          ':notescreen:' +
          oldtoken.notescreenuuid,
        ['active', '1', 'lastaccess', Date.now().toString()]
      )
      this.redis.hSet('lecture:' + oldtoken.lectureuuid, [
        'lastaccess',
        Date.now().toString()
      ])
    } catch (error) {
      console.log('redis problem in getNotepadToken', error)
    }
    return { token: await this.signNotepadJwt(newtoken), decoded: newtoken }
  }

  async setLectureProperties(
    args,
    casttoscreens,
    backgroundbw,
    showscreennumber
  ) {
    // console.log("sNs: lecture:"+args.lectureuuid+":notepad:"+args.notepaduuid);
    const tasks = []
    if (casttoscreens !== undefined && casttoscreens !== null) {
      tasks.push('casttoscreens')
      tasks.push(casttoscreens.toString())
    }
    if (backgroundbw !== undefined && backgroundbw !== null) {
      tasks.push('backgroundbw')
      tasks.push(backgroundbw.toString())
    }
    if (showscreennumber !== undefined && showscreennumber !== null) {
      tasks.push('showscreennumber')
      tasks.push(showscreennumber.toString())
    }
    if (tasks.length > 0)
      try {
        await this.redis.hSet('lecture:' + args.lectureuuid, tasks)
        this.emitscreenlists(args)
      } catch (error) {
        console.log('redis error in setLectureProperties', error)
      }
    /* this.notepadisscreen = isscreen;
     this.notepadscrollheight = scrollheight;
     this.casttoscreens = casttoscreens;
     this.backgroundbw = backgroundbw; */
  }

  async updateNoteScreen(args, scrollheight, purpose) {
    // console.log('update notescreen', scrollheight, purpose, args)
    try {
      await this.redis.hSet(
        'lecture:' + args.lectureuuid + ':notescreen:' + args.notescreenuuid,
        ['scrollheight', scrollheight.toString(), 'purpose', purpose]
      )
      this.emitscreenlists(args)
    } catch (error) {
      console.log('problem in updateNoteScreen', error)
    }
  }

  async getAvailablePicts(notepadscreenid) {
    let lecturedoc = {}
    try {
      const lecturescol = this.mongo.collection('lectures')
      lecturedoc = await lecturescol.findOne(
        { uuid: notepadscreenid.lectureuuid },
        {
          projection: { _id: 0, pictures: 1 }
        }
      )
      // console.log("lecturedoc",lecturedoc);

      if (!lecturedoc.pictures) return []

      return lecturedoc.pictures.map((el) => {
        return {
          name: el.name,
          mimetype: el.mimetype,
          sha: el.sha.buffer.toString('hex'),
          url: this.getFileURL(el.sha.buffer, el.mimetype),
          urlthumb: this.getFileURL(el.tsha.buffer, el.mimetype)
        }
      })
      // ok now I have the picture, but I also have to generate the urls
    } catch (err) {
      console.log('error in getAvailable pictures', err)
    }
  }

  async getAvailableIpynbs(notepadscreenid) {
    let lecturedoc = {}
    try {
      const lecturescol = this.mongo.collection('lectures')
      lecturedoc = await lecturescol.findOne(
        { uuid: notepadscreenid.lectureuuid },
        {
          projection: { _id: 0, ipynbs: 1 }
        }
      )

      if (!lecturedoc.ipynbs) return []

      return lecturedoc.ipynbs.map((el) => {
        return {
          name: el.name,
          filename: el.filename,
          note: el.note,
          id: el.id,
          sha: el.sha.buffer.toString('hex'),
          mimetype: el.mimetype,
          /* sha: el.sha.buffer.toString('hex'),  No download necessary ! */
          applets: el.applets?.map?.((applet) => ({
            appid: applet.appid,
            appname: applet.appname
          })),
          url: this.getFileURL(el.sha.buffer, el.mimetype)
        }
      })
      // ok now I have the ipynb, but I also have to generate the urls
    } catch (err) {
      console.log('error in getAvailableIpynbs', err)
    }
  }

  async uploadPicture(notepadscreenid, { name, type, picture, thumbnail }) {
    const picthash = createHash('sha256')
    picthash.update(picture)
    const thumbhash = createHash('sha256')
    thumbhash.update(thumbnail)

    const sha = picthash.digest()
    const tsha = thumbhash.digest()

    await Promise.all([
      this.saveFile(picture, sha, type, picture.length),
      this.saveFile(thumbnail, tsha, type, thumbnail.length)
    ])

    const lecturescol = this.mongo.collection('lectures')
    await lecturescol.updateOne(
      { uuid: notepadscreenid.lectureuuid },
      {
        $addToSet: {
          usedpictures: {
            name,
            mimetype: type,
            sha,
            tsha
          }
        },
        $currentDate: { lastaccess: true }
      }
    )

    return {
      sha: sha.toString('hex'),
      tsha: tsha.toString('hex')
    }
  }

  async getPicture(notepadscreenid, id) {
    try {
      const lecturescol = this.mongo.collection('lectures')
      // first figure out if it already is assigned to the lecture, we use here mongo db instead of the redis cache
      const lecturedoc = await lecturescol.findOne(
        { uuid: notepadscreenid.lectureuuid },
        {
          projection: { _id: 0, pictures: 1, usedpictures: 1 }
        }
      )

      if (!lecturedoc.usedpictures) lecturedoc.usedpictures = []

      const findex = lecturedoc.usedpictures.findIndex(
        (el) => el.sha.buffer.toString('hex') === id
      )

      if (findex === -1) {
        if (!lecturedoc.pictures) throw new Error('Pictures not found ' + id)
        // oh oh it is not found, but maybe it is available...
        const pindex = lecturedoc.pictures.findIndex(
          (el) => el.sha.buffer.toString('hex') === id
        )
        if (pindex === -1) {
          throw new Error('Picture not found ' + id)
        }
        const pinfo = lecturedoc.pictures[pindex]
        // and now move it to the used pictures....
        lecturescol.updateOne(
          { uuid: notepadscreenid.lectureuuid },
          {
            $addToSet: { usedpictures: pinfo },
            $currentDate: { lastaccess: true }
          }
        )
        lecturedoc.usedpictures.push(pinfo)
      } // else pinfo = lecturedoc.usedpictures[findex]

      return lecturedoc.usedpictures.map((el) => {
        return {
          name: el.name,
          mimetype: el.mimetype,
          sha: el.sha.buffer.toString('hex'),
          url: this.getFileURL(el.sha.buffer, el.mimetype),
          urlthumb: this.getFileURL(el.tsha.buffer, el.mimetype)
        }
      }, this)
    } catch (err) {
      console.log('error in getPicture', err)
    }

    return null
  }

  async getIpynb(notepadscreenid, id, sha) {
    try {
      const lecturescol = this.mongo.collection('lectures')
      // first figure out if it already is assigned to the lecture, we use here mongo db instead of the redis cache
      const lecturedoc = await lecturescol.findOne(
        { uuid: notepadscreenid.lectureuuid },
        {
          projection: { _id: 0, ipynbs: 1, usedipynbs: 1 }
        }
      )

      if (!lecturedoc.usedipynbs) lecturedoc.usedipynbs = []

      const findex = lecturedoc.usedipynbs.findIndex(
        (el) => el.sha.buffer.toString('hex') === sha && el.id === id
      )

      if (findex === -1) {
        if (!lecturedoc.ipynbs) throw new Error('No ipynbs found ' + id)
        // oh oh it is not found, but maybe it is available...
        const iindex = lecturedoc.ipynbs.findIndex(
          (el) => el.sha.buffer.toString('hex') === sha && el.id === id
        )
        if (iindex === -1) {
          throw new Error('Ipynb not found ' + id)
        }
        const iinfo = lecturedoc.ipynbs[iindex]
        // and now move it to the used inpnbs....
        lecturescol.updateOne(
          { uuid: notepadscreenid.lectureuuid },
          {
            $addToSet: { usedipynbs: iinfo },
            $currentDate: { lastaccess: true }
          }
        )
        lecturedoc.usedipynbs.push(iinfo)
      } // else pinfo = lecturedoc.usedpictures[findex]

      return lecturedoc.usedipynbs.map((el) => {
        return {
          name: el.name,
          note: el.note,
          id: el.id,
          mimetype: el.mimetype,
          sha: el.sha.buffer.toString('hex'),
          url: this.getFileURL(el.sha.buffer, el.mimetype),
          applets: el.applets?.map?.((applet) => ({
            appid: applet.appid,
            appname: applet.appname
          }))
        }
      }, this)
    } catch (err) {
      console.log('error in getIpynb', err)
    }
    return null
  }

  async getPolls(notepadscreenid) {
    // TODO should be feed from mongodb

    let lecturedoc = {}
    try {
      const lecturescol = this.mongo.collection('lectures')

      lecturedoc = await lecturescol.findOne(
        { uuid: notepadscreenid.lectureuuid },
        {
          projection: { _id: 0, polls: 1 }
        }
      )
      return lecturedoc.polls
    } catch (err) {
      console.log('error in getpolls', err)
    }
  }

  async startPoll(lectureuuid, { poll, limited, participants }) {
    const roomname = this.getRoomName(lectureuuid)
    // ok first thing, we have to create a salt and set it in redis!
    const randBytes = promisify(randomBytes)

    try {
      const pollsalt = (await randBytes(16)).toString('base64') // the salt is absolutely confidential, everyone who knows it can spoil secrecy of polling!
      await this.redis.set(
        'pollsalt:lecture:' + lectureuuid + ':poll:' + poll.id,
        pollsalt,
        { EX: 10 * 60 /* 10 Minutes for polling */ }
      ) // after the pollsalt is gone, the poll is over!
      const pollstateCmd = [
        'command',
        'startPoll',
        'data',
        JSON.stringify(poll),
        'limited',
        limited
      ]
      if (limited) {
        pollstateCmd.push('participants', JSON.stringify(participants))
      }
      this.redis.hSet('lecture:' + lectureuuid + ':pollstate', pollstateCmd)

      this.notepadio.to(roomname).emit('startPoll', { ...poll, participants }) // overwrite participants
      this.notesio.to(roomname).emit('startPoll', { ...poll, participants })
    } catch (err) {
      console.log('error in startpoll', err)
    }
  }

  async finishPoll(lectureuuid, data) {
    const roomname = this.getRoomName(lectureuuid)
    // ok first thing, we have to create a salt and set it in redis!

    try {
      this.redis.del('pollsalt:lecture:' + lectureuuid + ':poll:' + data.pollid) // after the pollsalt is gone, the poll is over!
      const parti = await this.redis.hGet(
        'lecture:' + lectureuuid + ':pollstate',
        'participants'
      )
      let participants
      if (!parti) {
        participants = JSON.parse(parti)
      }
      const res = data.result
        .filter((el) => /^[0-9a-zA-Z]{9}$/.test(el.id))
        .map((el) => ({ id: el.id, data: el.data, name: el.name }))
      this.redis.del('lecture:' + lectureuuid + ':pollstate')
      this.notepadio
        .to(roomname)
        .emit('finishPoll', { id: data.pollid, result: res, participants })
      this.notesio
        .to(roomname)
        .emit('finishPoll', { id: data.pollid, result: res })
    } catch (err) {
      console.log('error in finishpoll', err)
    }
  }

  async loadLectFromDB(lectureuuid) {
    const boardprefix = 'lecture:' + lectureuuid + ':board'

    let lock = null
    try {
      // console.log(' try to lock ', 'lecture:' + lectureuuid + ':loadlock')
      lock = await this.redlock.lock(
        'lecture:' + lectureuuid + ':loadlock',
        2000
      )
      const lecturescol = this.mongo.collection('lectures')
      const boardscol = this.mongo.collection('lectureboards')

      let lastwrite = this.redis.hGet('lecture:' + lectureuuid, 'lastwrite')
      const lecturedoc = await lecturescol.findOne(
        { uuid: lectureuuid },
        {
          projection: {
            _id: 0,
            boardsavetime: 1,
            backgroundbw: 1,
            backgroundpdfuse: 1
          }
        }
      )
      if (!lecturedoc.backgroundpdfuse) {
        lecturescol.updateOne(
          { uuid: lectureuuid },
          { $set: { backgroundpdfuse: 1 } }
        ) // we are starting the lecture lock the pdf
      }
      const boardsavetime = lecturedoc.boardsavetime
      const backgroundbw = lecturedoc.backgroundbw
      lastwrite = await lastwrite
      // console.log('lastwrite', lastwrite, boardsavetime, lecturedoc)

      if (!boardsavetime) {
        lock.unlock()
        return
      } // no save no transfer
      if (
        lastwrite &&
        boardsavetime &&
        Number(lastwrite) < Number(boardsavetime) + 10 * 60 * 1000
      ) {
        lock.unlock()
        return
      } // no newer data than 10 minutes no transfer, redis should  always be more recent
      console.log('loadLectFromDB for lecture ', lectureuuid)
      // ok we have green light, we can transfer the data from mongo to redis
      const cursor = boardscol.find({ uuid: lectureuuid })
      const redisprom = []
      const boards = []
      while (await cursor.hasNext()) {
        const boardinfo = await cursor.next()
        // console.log("boardinfo", boardinfo);
        // ok we have one document so push it to redis, TODO think of sending the documents directly to clients?
        if (!boardinfo.board || !boardinfo.boarddata) continue // no valid data
        boards.push(boardinfo.board)
        const myprom = this.redis.set(
          boardprefix + boardinfo.board,
          boardinfo.boarddata.buffer
        )
        redisprom.push(myprom)
      }
      // console.log('cursor it finished')
      await Promise.all(redisprom) // ok wait that everything is transfered and then update the time
      if (boards.length > 0)
        await this.redis.sAdd('lecture:' + lectureuuid + ':boards', boards)
      const hsetpara = []
      if (boardsavetime) {
        hsetpara.push('lastwrite')
        hsetpara.push(boardsavetime.toString())
      }
      if (backgroundbw) {
        hsetpara.push('backgroundbw')
        hsetpara.push(backgroundbw.toString())
      }
      if (hsetpara.length > 0)
        await this.redis.hSet('lecture:' + lectureuuid, hsetpara)
      console.log('loadLectFromDB successful for lecture', lectureuuid)
      lock.unlock()
    } catch (err) {
      console.log('loadLectFromDBErr', err, lectureuuid)
    }
  }

  async writeData(lectureuuid, number, data, append) {
    // TODO check mongo db
    if (append) {
      // if (!number) console.log("number not defined", number);
      try {
        this.redis.sAdd('lecture:' + lectureuuid + ':boards', number.toString())
        this.redis.hSet('lecture:' + lectureuuid, [
          'lastwrite',
          Date.now().toString()
        ])

        await this.redis.append(
          'lecture:' + lectureuuid + ':board' + number,
          Buffer.from(new Uint8Array(data))
        )
      } catch (error) {
        console.log('problem in writing data ' + lectureuuid, error)
      }
    } else {
      console.log('Warning! Attempt to write data in non append mode!')
    }
  }

  async addNewChannel(
    args,
    type,
    emitscreens // notebooks or screencast
  ) {
    const newuuid = uuidv4()
    // console.log('addnewchannel')
    try {
      await this.redis
        .multi()
        .lRem('lecture:' + args.lectureuuid + ':channels', 0, newuuid)
        .rPush('lecture:' + args.lectureuuid + ':channels', newuuid)
        .hSet('lecture:' + args.lectureuuid + ':channel:' + newuuid, [
          'type',
          type
        ])
        .exec()
      if (emitscreens) this.emitscreenlists(args)
    } catch (error) {
      console.log('problem add new channel', error)
    }

    return newuuid
  }

  async removeChannel(args, channeluuid) {
    await this.cleanupNotescreens(args)

    try {
      const targetchanneluuid = await this.redis.hGet(
        'lecture:' + args.lectureuuid + ':notescreen:' + args.notescreenuuid,
        'channel'
      )
      if (channeluuid === targetchanneluuid)
        console.log('tried to remove primary channel')

      await this.redis.executeIsolated(async (isoredis) => {
        await isoredis.watch([
          'lecture:' + args.lectureuuid + ':channel:' + channeluuid,
          'lecture:' +
            args.lectureuuid +
            ':channel:' +
            channeluuid +
            ':members',
          'lecture:' +
            args.lectureuuid +
            ':channel:' +
            targetchanneluuid +
            ':members',
          'lecture:' + args.lectureuuid + ':channels'
        ])

        const memberslength = await isoredis.lLen(
          'lecture:' + args.lectureuuid + ':channel:' + channeluuid + ':members'
        )

        const multi = isoredis.multi()

        for (let i = 0; i < memberslength; i++)
          multi.lMove(
            'lecture:' +
              args.lectureuuid +
              ':channel:' +
              channeluuid +
              ':members',
            'lecture:' +
              args.lectureuuid +
              ':channel:' +
              targetchanneluuid +
              ':members'
          )

        multi
          .del(
            'lecture:' +
              args.lectureuuid +
              ':channel:' +
              channeluuid +
              ':members'
          )
          .lRem('lecture:' + args.lectureuuid + ':channels', 0, channeluuid)
          .del('lecture:' + args.lectureuuid + ':channel:' + channeluuid)

        await multi.exec()
      })
    } catch (error) {
      console.log('removeChannel error', error)
    }
    this.emitscreenlists(args)
  }

  async cleanupNotescreens(args) {
    // ok first we need a list of notescreens
    try {
      const allscreens = await this.redis.sMembers(
        'lecture:' + args.lectureuuid + ':notescreens'
      )
      // console.log('allscreens', allscreens)
      // now we collect the active status of all member
      let todelete
      if (!allscreens) return
      todelete = await Promise.all(
        allscreens.map((el) => {
          // ok we got the uuid
          return Promise.all([
            el,
            this.redis.hmGet(
              'lecture:' + args.lectureuuid + ':notescreen:' + el,
              ['active', 'lastaccess']
            )
          ])
        }, this)
      )
      // console.log('todelete', todelete)
      todelete = todelete
        .filter((el) =>
          el[1] ? Date.now() - Number(el[1][1]) > 20 * 60 * 1000 : false
        ) // inverted active condition
        .map((el) => el[0])
      // console.log('todelete filter', todelete)
      if (todelete.length === 0) return // we are ready

      // now we have the list of notescreens for potential deletion, we have to watch all these recprds and check it again
      const towatch = todelete.map(
        (el) => 'lecture:' + args.lectureuuid + ':notescreen:' + el
      )
      // console.log('towatch', towatch)
      await this.redis.executeIsolated(async (isoredis) => {
        await isoredis.watch(towatch)

        let todelete2 = await Promise.all(
          todelete.map((el) => {
            // ok we got the uuid
            return Promise.all([
              el,
              isoredis.hmGet(
                'lecture:' + args.lectureuuid + ':notescreen:' + el,
                ['active', 'lastaccess']
              )
            ])
          }, this)
        )
        todelete2 = todelete2
          .filter((el) =>
            el[1] ? Date.now() - Number(el[1][1]) > 20 * 60 * 1000 : false
          ) // inverted active condition
          .map((el) => el[0])
        if (todelete2.length === 0) return // we are ready

        const channels = await isoredis.lRange(
          'lecture:' + args.lectureuuid + ':channels',
          0,
          -1
        )

        const channelwatch = channels.map(
          (el) => 'lecture:' + args.lectureuuid + ':channel:' + el + ':members'
        )
        // console.log('channelwatch', channelwatch)

        if (channelwatch.length > 0) await isoredis.watch(channelwatch) // also watch the channelmembers
        // now we are sure they are for deletion start the multi
        const multi = isoredis.multi()
        const deletenotescreens = todelete2.map(
          (el) => 'lecture:' + args.lectureuuid + ':notescreen:' + el
        )
        multi.del(deletenotescreens) // delete the notescreens
        // now remove them for them lists of notescreens
        multi.sRem('lecture:' + args.lectureuuid + ':notescreens', todelete2)
        // and from the channels
        if (channelwatch.length > 0)
          todelete2.forEach((notescreen) =>
            channelwatch.forEach((channel) => {
              multi.lRem(channel, 0, notescreen)
            })
          ) // everthings is queued now execute

        await multi.exec()
      })
    } catch (err) {
      console.log('cleanupNotescreen error ', err)
    }
  }

  async handleKeymasterQueryResponse(args, data, socket) {
    let now = Date.now() / 1000
    args.keymaster = false
    if (!data || !data.bidding) return
    let repeat = true
    let master = false
    let mastertime = 0
    while (repeat) {
      repeat = false

      try {
        await this.redis.executeIsolated(async (isoredis) => {
          await isoredis.watch('lecture:' + args.lectureuuid + ':keymaster')
          const biddingInfo = await isoredis.hGetAll(
            'lecture:' + args.lectureuuid + ':keymaster'
          )
          if (
            Number(biddingInfo.bidding) >= data.bidding ||
            args.socketid === biddingInfo.master ||
            Number(biddingInfo.queryTime) + 5 < now
          ) {
            isoredis.unwatch()
            return
          }
          /* console.log(
            'before hSet',
            args.lectureuuid,
            'lecture:' + args.lectureuuid + ':keymaster',
            data.bidding,
            args.socketid
          ) */
          /* const multiret = */ await isoredis
            .multi()
            .hSet('lecture:' + args.lectureuuid + ':keymaster', [
              'bidding',
              data.bidding.toString(),
              'master',
              args.socketid.toString()
            ])
            .exec()
          /*  console.log('master stuff', [
            'bidding',
            data.bidding.toString(),
            'master',
            args.socketid.toString()
          ]) */
          master = true
          mastertime = Number(biddingInfo.queryTime) + 6
        })
      } catch (error) {
        if (error instanceof WatchError) {
          repeat = true
          console.log('watch error')
        } else {
          console.log('error in handleKeymasterQueryResponse')
        }
      }
    }

    if (master) {
      // console.log('I can be master', args.socketid)
      now = Date.now() / 1000
      if (mastertime - now > 0)
        await new Promise(
          (resolve) => setTimeout(resolve),
          (mastertime - now) * 1000
        )

      const masterquery = await this.redis.hGet(
        'lecture:' + args.lectureuuid + ':keymaster',
        'master'
      )
      // console.log('pre emit keymasterQueryResponse', masterquery, args.socketid)
      if (masterquery && masterquery === args.socketid) {
        // console.log('I am master', args.socketid)
        // console.log('emit keymasterQueryResponse', args.socketid)
        socket.emit('keymasterQueryResponse', { keymaster: true })
        args.keymaster = true
      } else {
        // console.log('I am not master', args.socketid)
        socket.emit('keymasterQueryResponse', { keymaster: false })
      }
    } else {
      // console.log('I am not master', args.socketid)
      socket.emit('keymasterQueryResponse', { keymaster: false })
    }
  }

  async emitCryptoIdent(socket, args) {
    const allidents = await this.redis.hGetAll(
      'lecture:' + args.lectureuuid + ':idents'
    )
    for (const id in allidents) {
      allidents[id] = JSON.parse(allidents[id])
    }
    socket.emit('identList', allidents)
  }

  async handleAVoffer(args, cmd) {
    // ok to things to do, inform the others about the offer
    // and store the information in redis

    if (cmd.type !== 'video' && cmd.type !== 'audio' && cmd.type !== 'screen') {
      return
    }

    const roomname = this.getRoomName(args.lectureuuid)

    const message = {
      id: args.socketid,
      type: cmd.type
    }

    if (cmd.db) {
      message.db = cmd.db // loundness in case of audio
    }
    if (cmd.miScChg) {
      message.miScChg = cmd.miScChg
    }

    if (cmd.type === 'screen') {
      if (!args.screensharechannelid) {
        // ok, we have to create a new channel
        args.screensharechannelid = await this.addNewChannel(
          args,
          'screenshare',
          true
        )
      }
      message.channelid = args.screensharechannelid
    }

    this.notepadio.to(roomname).emit('avoffer', message)
    this.screenio.to(roomname).emit('avoffer', message)
    this.notesio.to(roomname).emit('avoffer', message)

    // we do not have to save the db value
    try {
      await this.redis.hSet('lecture:' + args.lectureuuid + ':avoffers', [
        cmd.type + ':' + args.socketid,
        Date.now().toString()
      ])
    } catch (error) {
      console.log('problem in handleAVoffer', error)
    }
  }

  async allowVideoQuestion(args, cmd) {
    if (!cmd.id) return // do not proceed without id.
    const roomname = this.getRoomName(args.lectureuuid)

    const message = {
      id: cmd.id,
      displayname: cmd.displayname,
      userhash: args.userhash
    }

    this.notepadio.to(roomname).emit('videoquestion', message)
    this.screenio.to(roomname).emit('videoquestion', message)
    this.notesio.to(roomname).emit('videoquestion', message)

    try {
      await this.redis.hSet('lecture:' + args.lectureuuid + ':videoquestion', [
        'permitted:' + cmd.id,
        JSON.stringify({
          displayname: args.displayname,
          userhash: args.userhash
        })
      ])
    } catch (error) {
      console.log('problem in allowVideoQuestion', error)
    }
  }

  async connectNotescreen(args) {
    // console.log('connectnotepads', args)
    this.lastaccess(args.lectureuuid)
    try {
      await this.redis
        .multi()
        .sAdd('lectures', args.lectureuuid)
        .sAdd(
          'lecture:' + args.lectureuuid + ':notescreens',
          args.notescreenuuid
        )
        .hSet(
          'lecture:' + args.lectureuuid + ':notescreen:' + args.notescreenuuid,
          [
            'purpose',
            args.purpose,
            'name',
            args.name,
            'active',
            '1',
            'lastaccess',
            Date.now().toString()
          ]
          /* todo may be we have to add an instance id */
        )
        .exec()
      let push = 'lPush'
      if (args.purpose === 'screen') push = 'rPush'

      const res = await this.redis.hGet(
        'lecture:' + args.lectureuuid + ':notescreen:' + args.notescreenuuid,
        'channel'
      )

      let channel
      if (res) {
        channel = res
        // console.log('already have channel', res)
        await this.redis
          .multi()
          .lRem(
            'lecture:' + args.lectureuuid + ':channel:' + channel + ':members',
            0,
            args.notescreenuuid
          )
          [push](
            'lecture:' + args.lectureuuid + ':channel:' + channel + ':members',
            args.notescreenuuid
          )
          .exec()
        this.emitscreenlists(args)
        // just in case, datastructures are broken
      } else {
        const lres = await this.redis.lRange(
          'lecture:' + args.lectureuuid + ':channels',
          0,
          1
        )
        channel = lres[0]
        // console.log('channel 1', channel)
        if (!channel) {
          channel = await this.addNewChannel(args, 'notebooks')
        }
        // console.log('channel 2', channel)
        await this.redis
          .multi()
          .hSet(
            'lecture:' +
              args.lectureuuid +
              ':notescreen:' +
              args.notescreenuuid,
            ['channel', channel]
          )
          .lRem(
            'lecture:' + args.lectureuuid + ':channel:' + channel + ':members',
            0,
            args.notescreenuuid
          )
          [push](
            'lecture:' + args.lectureuuid + ':channel:' + channel + ':members',
            args.notescreenuuid
          )
          .exec()
        this.emitscreenlists(args)
      }
    } catch (error) {
      console.log('error in connect notescreen', error)
      return false
    }

    /*  if (this.connectednotepads>1) { // no more than one notepad allowed
        this.connectednotepads=1;
        return false;
      } */
    return true
  }

  async disconnectNotescreen(args) {
    this.lastaccess(args.lectureuuid)
    // this.redis.srem("lecture:"+args.lectureuuid+":notescreens",0,args.notescreenuuid);
    const roomname = this.getRoomName(args.lectureuuid)
    try {
      const proms = []
      proms.push(
        this.redis.hSet(
          'lecture:' + args.lectureuuid + ':notescreen:' + args.notescreenuuid,
          ['active', '0']
        )
      )
      proms.push(
        this.redis.hDel(
          'lecture:' + args.lectureuuid + ':idents',
          args.socketid
        )
      )

      proms.push(
        this.redis.hDel(
          'lecture:' + args.lectureuuid + ':avoffers',
          'video:' + args.socketid
        )
      )
      proms.push(
        this.redis.hDel(
          'lecture:' + args.lectureuuid + ':avoffers',
          'audio:' + args.socketid
        )
      )
      proms.push(
        this.redis.hDel(
          'lecture:' + args.lectureuuid + ':avoffers',
          'screen:' + args.socketid
        )
      )
      // remove the screenshare channel
      if (args.screensharechannelid) {
        proms.push(this.removeChannel(args, args.screensharechannelid))
      }
      this.notepadio.to(roomname).emit('identDelete', { id: args.socketid })
      await Promise.all(proms)
      this.emitscreenlists(args)
    } catch (error) {
      // do not delete, a cleanup job will do this
      console.log('error disconnectNotescreen', error)
    }
  }

  async updateNotescreenActive(args) {
    this.addUpdateCryptoIdent(args)
    try {
      await this.redis.hSet(
        'lecture:' + args.lectureuuid + ':notescreen:' + args.notescreenuuid,
        ['active', '1', 'lastaccess', Date.now().toString()]
      )
    } catch (error) {
      console.log('error updateNotescreenActive', error)
    }
  }

  /*
  async iterOverNotescreens(args, itfunc) {
    try {
      const res = await this.redis.smembers(
        'lecture:' + args.lectureuuid + ':notescreens'
      )
      if (res) {
        res.forEach((item) => {
          // console.log("iterOverNoteScreem res", res);
          itfunc(item)
        })
      }
    } catch (error) {
      console.log('iterOverNotescreen error', error)
    }
  }
  */

  async getNoteScreens(args, funct) {
    try {
      const screens = await this.redis.sMembers(
        'lecture:' + args.lectureuuid + ':notescreens'
      )
      // console.log('our screens', screens)
      const screenret = Promise.all(
        screens.map(async (el, ind) => {
          const temp = await this.redis.hmGet(
            'lecture:' + args.lectureuuid + ':notescreen:' + el,
            ['name', 'purpose', 'channel', 'active', 'lastaccess']
          )
          return {
            name: temp[0],
            purpose: temp[1],
            channel: temp[2],
            active: temp[3],
            lastaccess: temp[4],
            uuid: el
          }
        }, this)
      )
      let toret = await screenret
      toret = toret.filter((el) =>
        el.lastaccess
          ? Date.now() - Number(el.lastaccess) < 20 * 60 * 1000 &&
            el.active !== '0'
          : false
      )
      return toret
    } catch (error) {
      console.log('error get Notescreen', error)
      return null
    }
  }

  async getPresentationinfo(args) {
    try {
      let lectprop = this.redis.hmGet('lecture:' + args.lectureuuid, [
        'casttoscreens',
        'backgroundbw',
        'showscreennumber'
      ])
      lectprop = await lectprop
      return {
        casttoscreens: lectprop[0] !== null ? lectprop[0] : 'false',
        backgroundbw: lectprop[1] !== null ? lectprop[1] : 'true',
        showscreennumber: lectprop[2] !== null ? lectprop[2] : 'false'
      }
    } catch (error) {
      console.log('getPresentationinfo', error)
      return null
    }
  }

  async getChannelNoteScreens(args) {
    try {
      let lectprop = this.redis.hmGet('lecture:' + args.lectureuuid, [
        'casttoscreens',
        'backgroundbw',
        'showscreennumber'
      ])
      const channels = await this.redis.lRange(
        'lecture:' + args.lectureuuid + ':channels',
        0,
        -1
      )
      // console.log("channels",channels);
      const channelret = channels.map((el) =>
        this.redis.lRange(
          'lecture:' + args.lectureuuid + ':channel:' + el + ':members',
          0,
          -1
        )
      )
      // console.log("channelsret",channelret);
      const channeldet = Promise.all(
        channelret.map(async (el, ind) => {
          const notescreenuuids = await el
          const channeluuid = channels[ind]
          const channelnotescreens = notescreenuuids.map(async (el2) => {
            const details = this.redis.hmGet(
              'lecture:' + args.lectureuuid + ':notescreen:' + el2,
              [
                'active',
                'name',
                'purpose',
                'channel',
                'scrollheight',
                'lastaccess'
              ]
            )
            return Promise.all([el2, details])
          }, this)
          const chandetail = this.redis.hmGet(
            'lecture:' + args.lectureuuid + ':channel:' + channeluuid,
            'type'
          )

          return Promise.all([
            channeluuid,
            Promise.all(channelnotescreens),
            chandetail
          ])
        }, this)
      )
      const temp = await channeldet
      const toret = temp.map((el) => ({
        channeluuid: el[0],
        notescreens: el[1]
          .map((el2) => ({
            active: el2[1][0],
            lastaccess: el2[1][5],
            name: el2[1][1],
            uuid: el2[0],
            purpose: el2[1][2],
            channel: el2[1][3],
            scrollheight: el2[1][4]
          })) // .forEach((el)=>(console.log("prefilter",el,el.active ? (el.active-Date.now()))< 20*60*1000 : false)))
          .filter((el) =>
            el.lastaccess
              ? Date.now() - Number(el.lastaccess) < 20 * 60 * 1000 &&
                el.active !== '0'
              : false
          ),
        type: el[2][0]
      }))
      lectprop = await lectprop
      return {
        channelinfo: toret,
        casttoscreens: lectprop[0],
        backgroundbw: lectprop[1],
        showscreennumber: lectprop[2]
      }
    } catch (error) {
      console.log(' getChannelNoteScreens', error)
      return null
    }
  }

  async assignNoteScreenToChannel(args) {
    // console.log('assignNotePadToChannel', args)
    try {
      // TODO get content of old channel
      await this.redis.executeIsolated(async (isoredis) => {
        await isoredis.watch(
          'lecture:' + args.lectureuuid + ':assignable',
          'lecture:' +
            args.lectureuuid +
            ':channel:' +
            args.channeluuid +
            ':members'
        )

        const res = await isoredis.hGet(
          'lecture:' + args.lectureuuid + ':notescreen:' + args.notescreenuuid,
          'channel'
        )
        const oldchanneluuid = res
        await isoredis.watch(
          'lecture:' +
            args.lectureuuid +
            ':channel:' +
            oldchanneluuid +
            ':members'
        )
        await isoredis
          .multi()
          .lRem(
            'lecture:' +
              args.lectureuuid +
              ':channel:' +
              oldchanneluuid +
              ':members',
            0,
            args.notescreenuuid
          )
          .rPush(
            'lecture:' +
              args.lectureuuid +
              ':channel:' +
              args.channeluuid +
              ':members',
            args.notescreenuuid
          )
          .hSet(
            'lecture:' +
              args.lectureuuid +
              ':notescreen:' +
              args.notescreenuuid,
            [
              'channel',
              args.channeluuid,
              'active',
              1,
              'lastaccess',
              Date.now().toString()
            ]
          )
          .exec()
      })
      this.emitscreenlists(args)
    } catch (error) {
      console.log('assignNotescreenToChannel', error)
    }
  }
}
