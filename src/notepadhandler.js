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

import { NetworkSource, Dispatcher, Collection, MemContainer, CallbackContainer } from 'fails-components-data';
import { v4 as uuidv4, validate as isUUID } from 'uuid';
import Chance from 'chance';
import { promisify } from "util";
import Redlock from 'redlock';
import { randomBytes } from 'crypto';



var chance = new Chance();

export class NoteScreenConnection {

  constructor(args) {
    this.redis = args.redis;
    this.mongo = args.mongo;
    this.notepadio = args.notepadio;
    this.screenio = args.screenio;
    this.notesio = args.notesio;
    this.getFileURL = args.getFileURL;

    this.signScreenJwt = args.signScreenJwt;
    this.signNotepadJwt = args.signNotepadJwt;

    this.screenUrl = args.screenUrl;
    this.notepadUrl = args.notepadUrl;

    this.notepadhandlerURL = args.notepadhandlerURL;


    this.redlock = new Redlock(
      [this.redis],
      {
        driftFactor: 0.01, // multiplied by lock ttl to determine drift time


        retryCount: 10,

        retryDelay: 200, // time in ms
        retryJitter: 200 // time in ms
      }
    );






    this.SocketHandlerNotepad = this.SocketHandlerNotepad.bind(this);
    this.SocketHandlerScreen = this.SocketHandlerScreen.bind(this);
    this.emitscreenlists = this.emitscreenlists.bind(this);

    this.lastaccess = this.lastaccess.bind(this);



  };

  lastaccess(uuid) {
    //TODO
    console.log("lastaccess", uuid);
  }


  async emitscreenlists(args) { // only lectureuuid
    let roomname = this.getRoomName(args.lectureuuid);

    let screens = this.getNoteScreens(args);

    let channelinfo = this.getChannelNoteScreens(args);

    let readyscreens = await screens;

    console.log("avil notepadscreens", args.notescreenuuid, readyscreens);
    this.notepadio.to(roomname).emit('availscreens',
      { screens: readyscreens });
    this.screenio.to(roomname).emit('availscreens',
      { screens: readyscreens });
    let readychannels = await channelinfo;
    console.log("channelinfo", readychannels);

    this.notepadio.to(roomname).emit('channelinfo', readychannels);
    this.screenio.to(roomname).emit('channelinfo', readychannels);




    /*this.getNoteScreens(args, (res) => {
      console.log("notepadscreens",args.notescreenuuid, res);
      
      
    });*/
  }



  // fullnotepad lifecycle
  async SocketHandlerNotepad(socket) {

    var address = socket.client.conn.remoteAddress;
    console.log("Client %s with ip %s  connected", socket.id,
      address);
    if (socket.decoded_token) console.log("Client username", socket.decoded_token.user.displayname);
    else console.log("no decoded token");

    console.log("decoded token", socket.decoded_token);


    if (!isUUID(socket.decoded_token.lectureuuid)) {
      console.log("lectureuuid in decoded token invalid");
    }

    var notepadscreenid = {
      lectureuuid: socket.decoded_token.lectureuuid,
      socketid: socket.id,
      notescreenuuid: socket.decoded_token.notescreenuuid,
      purpose: "notepad",
      user: socket.decoded_token.user,
      name: socket.decoded_token.name
    };
    this.cleanupNotescreens(notepadscreenid); // Cleanup
    //TODO
    /*this.getNoteScreens(notepadscreenid, ((screens)=>{
     socket.emit('availscreens',{screens: screens });
      }));*/

    await this.loadLectFromDB(notepadscreenid.lectureuuid);

    let curtoken = socket.decoded_token;



    var collection;
    var dispatcher;
    var networksource;


    // setup data for handling the connection

    collection = new Collection(function (id, data) {
      return new CallbackContainer(id, data);
    },
      {
        writeData: function (obj, number, data, append) {
          obj.writeData(notepadscreenid.lectureuuid, number, data, append);
        },
        obj: this
      });
    dispatcher = new Dispatcher(); // dispatcher adds time stamps
    dispatcher.addSink(collection);


    networksource = new NetworkSource(dispatcher);

    this.redis.get(Buffer.from("lecture:" + notepadscreenid.lectureuuid + ":boardcommand"), function (err, res) {
      if (err) console.log("get board command", err);
      else if (res) {
        var memcont = new MemContainer("command", {});
        /*var ab = new ArrayBuffer(res.length);
        var view = new Uint8Array(ab);
        for (var i = 0; i < res.length; i++) {
          view[i] = res[i];
        }*/
        let ab = res;

        memcont.replaceStoredData(ab);
        var cs = memcont.getCurCommandState();
        console.log("cs state", cs);
        dispatcher.setTimeandScrollPos(cs.time, cs.scrollx, cs.scrolly);
        if (socket) {
          socket.emit('drawcommand', {
            task: "scrollBoard",
            time: dispatcher.getTime(),
            x: dispatcher.scrollx,
            y: dispatcher.scrolly,
            timeSet: true
          });
        }

      }
    }.bind(this));
    /* if (notepadscreenid) {
       //notepadscreen.socket=socket;
       //notepadscreen.lecture.failsdata=true; // we have started giving a lecture
       /*var lectures=terms.getCourseLectures(cmd.termuuid,cmd.courseuuid
                 ,socket.decoded_token.authinfo);
       if (lectures) lectures.saveDB();*
       
     }*/

    this.connectNotescreen(notepadscreenid);
    notepadscreenid.roomname = this.getRoomName(notepadscreenid.lectureuuid);
    console.log("notepad connected, join room", notepadscreenid.roomname);
    if (notepadscreenid.roomname) socket.join(notepadscreenid.roomname);

    {
      let token = await this.getLectureToken(curtoken);
      curtoken = token.decoded;
      socket.emit('authtoken', { token: token.token });
    }

    socket.on('reauthor', async function () {
      // we use the information from the already present authtoken
      let token = await this.getLectureToken(curtoken);
      curtoken = token.decoded;
      this.updateNotescreenActive(notepadscreenid);
      socket.emit('authtoken', { token: token.token });
    }.bind(this));


    socket.on('sendboards', function (cmd) {




      console.log("notepad connected, send board data");
      this.sendBoardsToSocket(notepadscreenid.lectureuuid, socket);
      socket.emit('drawcommand', {
        task: "scrollBoard",
        time: dispatcher.getTime(), x: dispatcher.scrollx, y: dispatcher.scrolly, timeSet: true
      });


    }.bind(this));

    socket.on('createscreen', async function (callback) {
      // ok we create the credentials for a new screen
      let token = await this.createScreenForLecture(notepadscreenid, curtoken.maxrenew); // res contains token 
      callback({ token: token, screenurl: this.screenUrl });
    }.bind(this));

    socket.on('createnotepad', async function (callback) {
      // ok we create the credentials for a new screen
      let token = await this.createNotepadForLecture(notepadscreenid, curtoken.maxrenew); // res contains token 
      callback({ token: token, notepadurl: this.notepadUrl });
    }.bind(this));

    socket.on('createchannel', (() => {
      console.log("createchannel");
      this.addNewChannel(notepadscreenid, "notebooks", true /*emitscreenlist*/);
    }).bind(this));




    socket.on('updatesizes', function (cmd) {
      console.log("peek updatesizes", cmd);

      this.setLectureProperties(notepadscreenid, cmd.casttoscreens == true, cmd.backgroundbw == true, cmd.showscreennumber == true);

      this.updateNoteScreen(notepadscreenid, cmd.scrollheight, "notepad");

      //if (notepadscreenid.roomname) this.emitscreenlists(args); // update Notescreen should do this


    }.bind(this));

    socket.on('getAvailablePicts', async (callback) => {
      let pictinfo = await this.getAvailablePicts(notepadscreenid);
      callback(pictinfo);
    });

    socket.on('getPolls', async (callback) => {
      let polls = await this.getPolls(notepadscreenid);
      callback(polls);
    });

    socket.on('startPoll', ((cmd) => {
      if (cmd.poll && cmd.poll.children
        && cmd.poll.children.length
        && cmd.poll.name
        && /^[0-9a-zA-Z]{9}$/.test(cmd.poll.id)) {
        this.startPoll(notepadscreenid.lectureuuid, cmd.poll);
      } else {
        console.log("received corrupt poll", cmd.poll);
      }
    }).bind(this));

    socket.on('finishPoll', ((data) => {
      if (data.pollid && /^[0-9a-zA-Z]{9}$/.test(data.pollid)) {
        this.finishPoll(notepadscreenid.lectureuuid, data);
      } else {
        console.log("received corrupt finish poll", id);
      }
    }).bind(this));

    socket.on('drawcommand', async function (cmd) {
      var delayed = false;
      // special handling
      if (cmd.task == 'addPicture') {
        if (notepadscreenid) {
          var pictinfo = await this.getPicture(notepadscreenid, cmd.uuid);
          if (pictinfo) {
            this.notepadio.to(notepadscreenid.roomname).emit('pictureinfo', pictinfo);
            this.screenio.to(notepadscreenid.roomname).emit('pictureinfo', pictinfo);
            this.notesio.to(notepadscreenid.roomname).emit('pictureinfo', pictinfo);
          }

        }
      }
      //generell distribution
      if (notepadscreenid.roomname && !delayed) {
        this.notepadio.to(notepadscreenid.roomname).emit('drawcommand', cmd);
        this.screenio.to(notepadscreenid.roomname).emit('drawcommand', cmd);
        this.notesio.to(notepadscreenid.roomname).emit('drawcommand', cmd);
      }

      if (notepadscreenid) {
        networksource.receiveData(cmd);
      }
    }.bind(this));

    socket.on('FoG', function (cmd) {
      if (notepadscreenid.roomname) {
        this.notepadio.to(notepadscreenid.roomname).emit('FoG', cmd);
        this.screenio.to(notepadscreenid.roomname).emit('FoG', cmd);
        this.notesio.to(notepadscreenid.roomname).emit('FoG', cmd);
      }
    }.bind(this));

    socket.on('addnotescreentochannel', function (cmd) { //TODO new concept
      console.log("check addnotescreen cmd", cmd);
      if (isUUID(cmd.notescreenuuid) && isUUID(cmd.channeluuid)) {
        console.log("addnotescreentochannel", cmd.notescreenuuid, cmd.channeluuid);
        this.assignNoteScreenToChannel(
          {
            channeluuid: cmd.channeluuid,
            lectureuuid: notepadscreenid.lectureuuid,
            notescreenuuid: cmd.notescreenuuid,
          });
      }
    }.bind(this));



    socket.on('LogoutPublish', function (cmd) {
      if (notepadscreenid.roomname) {
        screenio.to(notepadscreenid.roomname).emit('LogoutPublish', cmd);
        /*if (notepadscreen) {
          this.unassignRelatedScreens(notepadscreenid);
        }*/
      }
    }.bind(this));



    socket.on('removechannel', function (cmd) {
      console.log("removechannel", cmd);
      if (isUUID(cmd.channeluuid)) {
        console.log("removechannel request", cmd.channeluuid);
        this.removeChannel(notepadscreenid, cmd.channeluuid);


      }

    }.bind(this));


    socket.on('disconnect', function () {
      console.log("Client %s with ip %s  disconnected", socket.id,
        address);
      if (notepadscreenid.roomname) {
        socket.leave(notepadscreenid.roomname);
        notepadscreenid.roomname = null;
      }
      if (notepadscreenid) {
        //delete  notepadscreen.socket;
        this.disconnectNotescreen(notepadscreenid);
        //notepadscreenid=null;
      }
    }.bind(this));
  }

  async SocketHandlerScreen(socket) {
    var address = socket.client.conn.remoteAddress;
    console.log("Screen %s with ip %s  connected", socket.id,
      address);
    console.log("Screen name", socket.decoded_token.name);
    console.log("Screen uuid", socket.decoded_token.notescreenuuid);
    console.log("Screen lecture uuid", socket.decoded_token.lectureuuid);


    var notepadscreenid = null;

    var purescreen = null;
    var purescreen = {
      socketid: socket.id,
      lectureuuid: socket.decoded_token.lectureuuid,
      notescreenuuid: socket.decoded_token.notescreenuuid,
      name: socket.decoded_token.name,
      purpose: "screen",
      color: socket.decoded_token.color
    };

    await this.loadLectFromDB(purescreen.lectureuuid);

    this.connectNotescreen(purescreen);
    //this.addScreen(purescreen);

    let curtoken = socket.decoded_token;




    console.log("screen connected");
    notepadscreenid = purescreen.lectureuuid;


    //bIG TODO
    this.getLectDetail(purescreen, socket);

    console.log("screen send board data");
    this.sendBoardsToSocket(purescreen.lectureuuid, socket);
    purescreen.roomname = this.getRoomName(purescreen.lectureuuid);
    console.log("screen is connected to notepad, join room", purescreen.roomname);
    socket.join(purescreen.roomname);


    /*} else {
      console.log("screen unauthorized",socket.screendata);
      return;
    }*/
    {
      let token =await  this.getScreenToken(curtoken);
      curtoken = token.decoded;
      socket.emit('authtoken', { token: token.token });
    }

    socket.on('reauthor',async  function () {
      // we use the information from the already present authtoken
      let token = await this.getScreenToken(curtoken);
      this.updateNotescreenActive(purescreen);
      curtoken = token.decoded;
      socket.emit('authtoken', { token: token.token });
    }.bind(this));




    socket.on('updatesizes', function (cmd) {
      if (purescreen) {
        this.updateNoteScreen(purescreen, cmd.scrollheight, "screen");

        /*if (notepadscreen) {
          var info=this.getSendSizes(notepadscreenid);
          if (purescreen.roomname) {
            notepadio.to(purescreen.roomname).emit('updatescreensizes',info);
            screenio.to(purescreen.roomname).emit('updatescreensizes',info);
          }
        }*/
        //todo send also to screens
      }

    }.bind(this));




    socket.on('disconnect', function () {
      console.log("Screen Client %s with ip %s  disconnected", socket.id,
        address);
      if (purescreen) {
        if (purescreen.roomname) {
          socket.leave(purescreen.roomname);
          console.log("screen disconnected leave room", purescreen.roomname);
          purescreen.roomname = null;
        }
        /*if (purescreen.socketid) {
          purescreen.socketid = null;
        }*/
        //this.updatePurescreen(purescreen);
      }

      this.disconnectNotescreen(purescreen);



    }.bind(this));

  }


  async createScreenForLecture(notepadscreenid, maxrenew) {
    var content = {
      lectureuuid: notepadscreenid.lectureuuid,
      notescreenuuid: uuidv4(),
      purpose: "screen",
      color: chance.color(),
      notepadhandler: this.notepadhandlerURL,
      maxrenew: maxrenew,
      name: chance.profession({ rank: true }) + " of " + chance.country({ full: true })
    };
    return await this.signScreenJwt(content);
  }

  async createNotepadForLecture(notepadscreenid, maxrenew) {
    var content = {
      lectureuuid: notepadscreenid.lectureuuid,
      notescreenuuid: uuidv4(),
      purpose: "lecture",
      name: "Secondary Notebook",
      user: notepadscreenid.user,
      notepadhandler: this.notepadhandlerURL,
      maxrenew: maxrenew
    };
    return await this.signNotepadJwt(content);
  }

  async getScreenToken(oldtoken) {
    let newtoken = {
      lectureuuid: oldtoken.lectureuuid,
      notescreenuuid: oldtoken.notescreenuuid,
      purpose: "screen", // in case a bug is there, no one should escape the realm
      color: oldtoken.color,
      name: oldtoken.name,
      notepadhandler: this.notepadhandlerURL,
      maxrenew: (oldtoken.maxrenew - 1)
    };
    if (!oldtoken.maxrenew || !(oldtoken.maxrenew > 0)) return { error: "maxrenew token failed", oldtoken: oldtoken };
    this.redis.hmset("lecture:" + oldtoken.lectureuuid + ":notescreen:" + oldtoken.notescreenuuid, "active", 1, "lastaccess", Date.now());
    this.redis.hmset("lecture:" + oldtoken.lectureuuid, "lastaccess", Date.now());
    return { token: await  this.signScreenJwt(newtoken), decoded: newtoken };
  }

  async getLectureToken(oldtoken) {
    let newtoken = {
      user: oldtoken.user,
      purpose: "notepad",
      lectureuuid: oldtoken.lectureuuid,
      notescreenuuid: oldtoken.notescreenuuid,
      notepadhandler: this.notepadhandlerURL,
      name: oldtoken.name,
      maxrenew: (oldtoken.maxrenew - 1)
    };
    if (!oldtoken.maxrenew || !(oldtoken.maxrenew > 0)) return { error: "maxrenew token failed", oldtoken: oldtoken };
    this.redis.hmset("lecture:" + oldtoken.lectureuuid + ":notescreen:" + oldtoken.notescreenuuid, "active", 1, "lastaccess", Date.now());
    this.redis.hmset("lecture:" + oldtoken.lectureuuid, "lastaccess", Date.now());
    return { token: await this.signNotepadJwt(newtoken), decoded: newtoken };
  }



  setLectureProperties(args, casttoscreens, backgroundbw, showscreennumber) {
    //console.log("sNs: lecture:"+args.lectureuuid+":notepad:"+args.notepaduuid);
    this.redis.hmset("lecture:" + args.lectureuuid,
      "casttoscreens", casttoscreens,
      "backgroundbw", backgroundbw,
      "showscreennumber", showscreennumber,
      (err, res) => {
        //console.log("result sNS",err,res);
        this.emitscreenlists(args);
      }
    );
    /* this.notepadisscreen = isscreen;
     this.notepadscrollheight = scrollheight;
     this.casttoscreens = casttoscreens;
     this.backgroundbw = backgroundbw;*/
  };


  updateNoteScreen(args, scrollheight, purpose) {
    console.log("update notescreen", scrollheight, purpose, args);
    this.redis.hmset("lecture:" + args.lectureuuid + ":notescreen:" + args.notescreenuuid,
      "scrollheight", scrollheight,
      "purpose", purpose,
      function (err, res) {
        this.emitscreenlists(args);

      }.bind(this)
    );



  }


  async getAvailablePicts(notepadscreenid) {
    let lecturedoc = {};
    try {
      let lecturescol = this.mongo.collection("lectures");
      lecturedoc = await lecturescol.findOne({ "uuid": notepadscreenid.lectureuuid }, {
        projection:
          { "_id": 0, pictures: 1 }
      });
      //console.log("lecturedoc",lecturedoc);

      return lecturedoc.pictures.map((el) => {
        return {
          name: el.name, mimetype: el.mimetype,
          sha: el.sha.buffer.toString('hex'),
          url: this.getFileURL(el.sha.buffer,el.mimetype),
          urlthumb: this.getFileURL(el.tsha.buffer,el.mimetype)
        }
      });
      // ok now I have the picture, but I also have to generate the urls  

    } catch (err) {
      console.log("error in getAvailable pictures", err);
    }
  }

  async getBgpdf(notepadscreenid) {
    let lecturedoc = {};
    try {
      let lecturescol = this.mongo.collection("lectures");
      lecturedoc = await lecturescol.findOne({ "uuid": notepadscreenid.lectureuuid }, {
        projection:
          { "_id": 0, backgroundpdfuse: 1, backgroundpdf: 1 }
      });
      //console.log("lecturedoc",lecturedoc);
      if (!lecturedoc.backgroundpdfuse || !lecturedoc.backgroundpdf
        || !lecturedoc.backgroundpdf.sha) return null;
      return this.getFileURL(lecturedoc.backgroundpdf.sha,'application/pdf');

    } catch (err) {
      console.log("error in getBgpdf pictures", err);
    }

  }

  async getUsedPicts(notepadscreenid) {
    let lecturedoc = {};
    try {
      let lecturescol = this.mongo.collection("lectures");
      lecturedoc = await lecturescol.findOne({ "uuid": notepadscreenid.lectureuuid }, {
        projection:
          { "_id": 0, usedpictures: 1 }
      });
      //console.log("lecturedoc",lecturedoc);
      if (!lecturedoc.usedpictures) return [];

      return lecturedoc.usedpictures.map((el) => {
        return {
          name: el.name, mimetype: el.mimetype,
          sha: el.sha.buffer.toString('hex'),
          url: this.getFileURL(el.sha.buffer,el.mimetype),
          urlthumb: this.getFileURL(el.tsha.buffer,el.mimetype)
        }
      });
      // ok now I have the picture, but I also have to generate the urls  

    } catch (err) {
      console.log("error in getUsedPicts pictures", err);
    }
  }

  async getPicture(notepadscreenid, id) {
    try {
      let lecturescol = this.mongo.collection("lectures");
      // first figure out if it already is assigned to the lecture, we use here mongo db instead of the redis cache
      let lecturedoc = await lecturescol.findOne({ "uuid": notepadscreenid.lectureuuid }, {
        projection:
          { "_id": 0, pictures: 1, usedpictures: 1 }
      });

      if (!lecturedoc.usedpictures) lecturedoc.usedpictures = [];

      let findex = lecturedoc.usedpictures.findIndex((el) => (el.sha.buffer.toString('hex') == id));


      if (findex == -1) {
        if (!lecturedoc.pictures) throw "No picture not found " + id;
        //oh oh it is not found, but maybe it is available...
        let pindex = lecturedoc.pictures.findIndex((el) => (el.sha.buffer.toString('hex') == id));
        if (pindex == -1) {
          throw "Picture not found " + id;
        }
        let pinfo = lecturedoc.pictures[pindex];
        // and now move it to the used pictures....
        lecturescol.updateOne({ uuid: notepadscreenid.lectureuuid }, { $addToSet: { usedpictures: pinfo }, $currentDate: { lastaccess: true } });
        lecturedoc.usedpictures.push(pinfo);


      } else pinfo = lecturedoc.usedpictures[findex];



      return lecturedoc.usedpictures.map((el) => {
        return {
          name: el.name, mimetype: el.mimetype,
          sha: el.sha.buffer.toString('hex'),
          url: this.getFileURL(el.sha.buffer),
          urlthumb: this.getFileURL(el.tsha.buffer)
        }
      });


    } catch (err) {
      console.log("error in getPicture", err);
    }

    return null;
  }

  async getLectDetail(notepadscreenid, socket) { // TODO should be feed from mongodb

    let lecturedoc = {};
    try {
      let lecturescol = this.mongo.collection("lectures");


      lecturedoc = await lecturescol.findOne({ "uuid": notepadscreenid.lectureuuid }, {
        projection:
          { "_id": 0, title: 1, coursetitle: 1, ownersdisplaynames: 1, date: 1 }
      });

    } catch (err) {
      console.log("error in get LectDetail", err);
    }

    var lectdetail = {
      title: lecturedoc.title,
      coursetitle: lecturedoc.coursetitle,
      instructors: lecturedoc.ownersdisplaynames,
      date: lecturedoc.date
    };
    //if (notepadscreenid.notepaduuid) lectdetail.notepaduuid=notepadscreenid.notepaduuid;
    socket.emit('lecturedetail', lectdetail);

  }

  async getPolls(notepadscreenid) { // TODO should be feed from mongodb

    let lecturedoc = {};
    try {
      let lecturescol = this.mongo.collection("lectures");


      lecturedoc = await lecturescol.findOne({ "uuid": notepadscreenid.lectureuuid }, {
        projection:
          { "_id": 0, polls: 1 }
      });
      return lecturedoc.polls;

    } catch (err) {
      console.log("error in getpolls", err);
    }
  }

  async startPoll(lectureuuid, poll) {
    let roomname = this.getRoomName(lectureuuid);
    let client = this.redis;
    let set = promisify(this.redis.set).bind(client);
    // ok first thing, we have to create a salt and set it in redis!
    let pollsalt = randomBytes(16).toString('base64'); // the salt is absolutely confidential, everyone who knows it can spoil secrecy of polling!
    try {

      set("pollsalt:lecture:" + lectureuuid + ":poll:" + poll.id, pollsalt, "EX", 10 * 60 /*10 Minutes for polling*/); // after the pollsalt is gone, the poll is over!
      this.notepadio.to(roomname).emit('startPoll', poll);
      this.notesio.to(roomname).emit('startPoll', poll);
    } catch (err) {
      console.log("error in startpoll", err);
    }

  }

  async finishPoll(lectureuuid, data) {
    let roomname = this.getRoomName(lectureuuid);
    let client = this.redis;
    let del = promisify(this.redis.del).bind(client);
    // ok first thing, we have to create a salt and set it in redis!

    try {

      del("pollsalt:lecture:" + lectureuuid + ":poll:" + data.pollid); // after the pollsalt is gone, the poll is over!
      let res = data.result.filter((el) => (/^[0-9a-zA-Z]{9}$/.test(el.id))).map((el) => ({ id: el.id, data: el.data, name: el.name }));
      this.notepadio.to(roomname).emit('finishPoll', { id: data.pollid, result: res });
      this.notesio.to(roomname).emit('finishPoll', { id: data.pollid, result: res });
    } catch (err) {
      console.log("error in finishpoll", err);
    }

  }

  async houseKeeping() {
    let lock;
    try {
      lock = await this.redlock.lock("housekeeping", 2000);
      console.log("Do saveChangedLectures");
      await this.saveChangedLectures();
      console.log("tryLectureRedisPurge");
      await this.tryLectureRedisPurge();
      console.log("House keeping done!");
      lock.unlock();
    } catch (error) {
      console.log("Busy or Error in Housekeeping", error);
    }

  }

  async saveChangedLectures() {
    let client = this.redis;
    let scan = promisify(this.redis.scan).bind(client);
    let hmget = promisify(this.redis.hmget).bind(client);
    try {
      let cursor = 0;
      do {

        let scanret = await scan(cursor, 'MATCH', "lecture:????????-????-????-????-????????????", 'COUNT', 20);
        //console.log("scanret", scanret);
        // got the lectures now figure out, which we need to save
        let saveproms = Promise.all(scanret[1].map(async (el) => {

          let info = await hmget(el, "lastwrite", "lastDBsave");
          //console.log("our info",info);
          if (info[0] > (info[1] + 3 * 60 * 1000)) { // do not save more often than every 3 minutes
            let lectureuuid = el.substr(8);
            return this.saveLectureToDB(lectureuuid);
          } else return null;
        }));
        await saveproms; // wait before next iteration, do not use up to much mem

        cursor = scanret[0];
      } while (cursor != 0)

    } catch (error) {
      console.log("Error saveChangedLecture", error);
    }

  }

  async saveLectureToDB(lectureuuid) {
    let client = this.redis;
    let smembers = promisify(this.redis.smembers).bind(client);
    let get = promisify(this.redis.get).bind(client);
    let hset = promisify(this.redis.hset).bind(client);
    let hget = promisify(this.redis.hget).bind(client);
    let time = Date.now();
    console.log("Try saveLectureToDB  for lecture", lectureuuid);
    try {
      let lecturescol = this.mongo.collection("lectures");
      let boardscol = this.mongo.collection("lectureboards");
      // we got now through all boards and save them to the db

      let boardprefix = "lecture:" + lectureuuid + ":board";
      let update = [];
      let backgroundp = hget("lecture:" + lectureuuid, "backgroundbw");


      let members = await smembers(boardprefix + "s");
      let copyprom = Promise.all(members.map(async (el) => {
        let boardname = el;
        //if (boardname=="s") return null; // "boards excluded"
        //console.log("one board", el);
        //console.log("boardname", boardname);
        let boarddata = await get(Buffer.from(boardprefix + el));
        if (boarddata) { // got it now store it
          update = boardscol.updateOne({ "uuid": lectureuuid, "board": boardname }, {
            $set: {
              savetime: time,
              boarddata: boarddata
            }
          }, { upsert: true });
          return Promise.all([boardname, update]);

        } else return null;

      }));
      update = update.concat(await copyprom); // reduces memory footprint

      let allboards = update.filter((el) => (!!el)).map((el) => (el ? el[0] : null));
      //console.log("allbaords", allboards);
      let backgroundbw = await backgroundp;
      lecturescol.updateOne({ "uuid": lectureuuid }, {
        $set:
          { "boards": allboards, "boardsavetime": time, "backgroundbw": backgroundbw }
      });
      await hset("lecture:" + lectureuuid, "lastDBsave", Date.now());
      console.log("saveLectureToDB successful for lecture", lectureuuid);


    } catch (err) {
      console.log("saveLectToDBErr", err, lectureuuid);
    }
  }

  async loadLectFromDB(lectureuuid) {
    let client = this.redis;
    let hget = promisify(this.redis.hget).bind(client);
    let hmset = promisify(this.redis.hmset).bind(client);
    let set = promisify(this.redis.set).bind(client);
    let sadd = promisify(this.redis.sadd).bind(client);
    let boardprefix = "lecture:" + lectureuuid + ":board";


    let lock = null;
    try {
      console.log(" try to lock ", "lecture:" + lectureuuid + ":loadlock");
      lock = await this.redlock.lock("lecture:" + lectureuuid + ":loadlock", 2000);
      let lecturescol = this.mongo.collection("lectures");
      let boardscol = this.mongo.collection("lectureboards");

      let lastwrite = hget("lecture:" + lectureuuid, "lastwrite");
      let lecturedoc = await lecturescol.findOne({ "uuid": lectureuuid }, {
        projection:
          { "_id": 0, "boardsavetime": 1, "backgroundbw": 1, "backgroundpdfuse": 1 }
      });
      if (!lecturedoc.backgroundpdfuse) {
        lecturescol.updateOne({ "uuid": lectureuuid }, { $set: { "backgroundpdfuse": 1 } }); // we are starting the lecture lock the pdf
      }
      let boardsavetime = lecturedoc.boardsavetime;
      let backgroundbw = lecturedoc.backgroundbw;
      lastwrite = await lastwrite;
      console.log("lastwrite", lastwrite, boardsavetime, lecturedoc);

      if (!boardsavetime) { lock.unlock(); return; } // no save no transfer
      if ((lastwrite && boardsavetime) && lastwrite < (boardsavetime + 10 * 60 * 1000)) { lock.unlock(); return; } // no newer data than 10 minutes no transfer, redis should  always be more recent
      console.log("loadLectFromDB for lecture ", lectureuuid);
      // ok we have green light, we can transfer the data from mongo to redis
      let cursor = boardscol.find({ "uuid": lectureuuid });
      let redisprom = [];
      let boards = [];
      while (await cursor.hasNext()) {
        let boardinfo = await cursor.next();
        //console.log("boardinfo", boardinfo);
        // ok we have one document so push it to redis, TODO think of sending the documents directly to clients?
        if (!boardinfo.board || !boardinfo.boarddata) continue; // no valid data
        boards.push(boardinfo.board);
        let myprom = set(boardprefix + boardinfo.board, boardinfo.boarddata.buffer);
        redisprom.push(myprom);
      }
      console.log("cursor it finished");
      await Promise.all(redisprom); // ok wait that everything is transfered and then update the time
      if (boards.length > 0) await sadd("lecture:" + lectureuuid + ":boards", boards);
      await hmset("lecture:" + lectureuuid, "lastwrite", boardsavetime, "backgroundbw", backgroundbw);
      console.log("loadLectFromDB successful for lecture", lectureuuid);
      lock.unlock();

    } catch (err) {
      console.log("loadLectFromDBErr", err, lectureuuid);
    }
  }

  async tryLectureRedisPurge() {
    let client = this.redis;
    // ok we got through all lectures and collect last access times
    let scan = promisify(this.redis.scan).bind(client);
    let hmget = promisify(this.redis.hmget).bind(client);
    let unlink = promisify(this.redis.unlink).bind(client);

    try {
      let cursor = 0;
      let allprom = [];

      do {


        let scanret = await scan(cursor, 'MATCH', "lecture:????????-????-????-????-????????????", 'COUNT', 40);
        // ok we figure out one by one if we should delete
        //console.log("purge scanret", scanret);
        let myprom = Promise.all(scanret[1].map(async (el) => {
          let lastaccessesp = [];
          
          lastaccessesp.push(hmget(el, "lastwrite", "lastaccess"));
            

          // ok but also the notescreens are of interest

          let cursor2 = 0;
          do {
            let scanret2 = await scan(cursor2, 'MATCH', el + ":notescreen:????????-????-????-????-????????????");
            //console.log("purge scanret2", scanret2);
            let myprom2 = scanret2[1].map((el2) => {
              return hmget(el2, "lastaccess");

            });
            lastaccessesp.push(...myprom2);

            cursor2 = scanret2[0];
          } while (cursor2 != 0);

          let laarr = await Promise.all(lastaccessesp);
          laarr=laarr.flat();
          //console.log("laar",laarr);
          let la = Math.max(...laarr);
          //console.log("lastaccess",la,Date.now()-la );
          let retprom = [];
          //console.log("before purge");
          if ((Date.now() - la) > 30 * 60 * 1000) {
            console.log("Starting to purge lecture ", el);
            // purge allowed
            retprom.push(unlink(el));
            let pcursor = 0;
            do {
              let pscanret = await scan(pcursor, 'MATCH', el + ":*");
              console.log("purge element", pscanret);
              pcursor = pscanret[0];
              retprom.push(... (pscanret[1].map((el2) => (unlink(el2)))));

            } while (pcursor != 0);


          }
          return Promise.all(retprom);

        }));
        allprom.push(myprom);
        cursor = scanret[0];

      } while (cursor != 0);
      await Promise.all(allprom); // we are finished giving orders, wait for return
      return;

    } catch (err) {
      console.log("tryLectureRedisPurge error", err);
    }

  }


  async sendBoardsToSocket(lectureuuid, socket) {
    //we have to send first information about pictures

    let usedpict = await this.getUsedPicts({ lectureuuid: lectureuuid });
    if (usedpict) {
      socket.emit('pictureinfo', usedpict);
    }
    let bgpdf = await this.getBgpdf({ lectureuuid: lectureuuid });
    if (bgpdf) {
      socket.emit('bgpdfinfo', { bgpdfurl: bgpdf });
    } else {
      socket.emit('bgpdfinfo', { none: true });
    }


    this.redis.smembers("lecture:" + lectureuuid + ":boards", function (err, res) { //TODO sync to mongodb
      if (err) console.log("boards in sendBoardsToSocket picture", err);
      else {
        console.log("boards", res, "lecture:" + lectureuuid + ":boards");
        var length = res.length;
        var countdown = length;
        for (let index in res) {
          let boardnum = res[index];
          console.log("sendBoardsToSocket", boardnum, lectureuuid);
          this.redis.get(Buffer.from("lecture:" + lectureuuid + ":board" + boardnum), function (err2, res2) {
            if (err2) console.log("get board in sendBoardsToSocket picture", err2);
            countdown--;
            // console.log("send reloadboard",boardnum,res2,length);
            var send = {
              number: boardnum, data: res2,
              last: countdown == 0
            };
            socket.emit('reloadBoard', send);
          });
        }
      }
    }.bind(this));



  };





  writeData(lectureuuid, number, data, append) {
    //TODO check mongo db
    if (append) {
      //if (!number) console.log("number not defined", number);
      this.redis.sadd("lecture:" + lectureuuid + ":boards", number);
      this.redis.hmset("lecture:" + lectureuuid, "lastwrite", Date.now());


      this.redis.append("lecture:" + lectureuuid + ":board" + number, Buffer.from(new Uint8Array(data)),
        function (error, res) {
          if (error) console.log("Error appending data " + lectureuuid, error);
        }
      );


    } else {
      console.log("Warning! Attempt to write data in non append mode!");
    }
  };



  getRoomName(uuid) {
    return uuid;
  }


  addNewChannel(args, type, emitscreens) // notebooks or screencast
  {
    let newuuid = uuidv4();
    console.log("addnewchannel");
    this.redis.multi().lrem("lecture:" + args.lectureuuid + ":channels", 0, newuuid)
      .rpush("lecture:" + args.lectureuuid + ":channels", newuuid)
      .hmset("lecture:" + args.lectureuuid + ":channel:" + newuuid, "type", type)
      .exec(() => {
        if (emitscreens) this.emitscreenlists(args);
      });

    return newuuid;

  }

  async removeChannel(args, channeluuid) {
    await this.cleanupNotescreens(args);

    let client = this.redis;
    let hget = promisify(this.redis.hget).bind(client);
    let llen = promisify(this.redis.llen).bind(client);

    try {
      let targetchanneluuid = await hget("lecture:" + args.lectureuuid + ":notescreen:" + args.notescreenuuid, "channel");
      if (channeluuid == targetchanneluuid) console.log("tried to remove primary channel")

      this.redis.watch("lecture:" + args.lectureuuid + ":channel:" + channeluuid,
        "lecture:" + args.lectureuuid + ":channel:" + channeluuid + ":members", "lecture:" + args.lectureuuid + ":channel:" + targetchanneluuid + ":members",
        "lecture:" + args.lectureuuid + ":channels");

      let memberslength = await llen("lecture:" + args.lectureuuid + ":channel:" + channeluuid + ":members");

      let multi = this.redis.multi();

      for (let i = 0; i < memberslength; i++)
        multi.lmove("lecture:" + args.lectureuuid + ":channel:" + channeluuid + ":members",
          "lecture:" + args.lectureuuid + ":channel:" + targetchanneluuid + ":members");

      multi.del("lecture:" + args.lectureuuid + ":channel:" + channeluuid + ":members")
        .lrem("lecture:" + args.lectureuuid + ":channels", 0, channeluuid)
        .del("lecture:" + args.lectureuuid + ":channel:" + channeluuid);

      let exec = promisify(multi.exec).bind(multi);

      await exec();


    } catch (error) {
      console.log("removeChannel error", err)
    }
    this.emitscreenlists(args);

  }

  async cleanupNotescreens(args) {
    // ok first we need a list of notescreens
    let client = this.redis;
    let smembers = promisify(this.redis.smembers).bind(client);
    let hmget = promisify(this.redis.hmget).bind(client);
    let lrange = promisify(this.redis.lrange).bind(client);
    try {
      let allscreens = await smembers("lecture:" + args.lectureuuid + ":notescreens");
      // now we collect the active status of all member
      let todelete = await Promise.all(allscreens.map((el) => {
        // ok we got the uuid
        return Promise.all([el, hmget("lecture:" + args.lectureuuid + ":notescreen:" + el, "active", "lastaccess")]);
      }));
      console.log("todelete", todelete);
      todelete = todelete.filter((el) => ((el[1] ? ((Date.now() - el[1][1]) > 20 * 60 * 1000) : false))) // inverted active condition
        .map((el) => (el[0]));
      console.log("todelete filter", todelete);
      if (todelete.length == 0) return; // we are ready

      // now we have the list of notescreens for potential deletion, we have to watch all these recprds and check it again
      let towatch = todelete.map((el) => ("lecture:" + args.lectureuuid + ":notescreen:" + el));
      //console.log("towatch",towatch);
      this.redis.watch(towatch); // we do not need a promise here, now again check what is going on

      let todelete2 = await Promise.all(todelete.map((el) => {
        // ok we got the uuid
        return Promise.all([el, hmget("lecture:" + args.lectureuuid + ":notescreen:" + el, "active", "lastaccess")]);
      }));
      todelete2 = todelete2.filter((el) => ((el[1] ? ((Date.now() - el[1][1]) > 20 * 60 * 1000) : false))) // inverted active condition
        .map((el) => (el[0]));
      if (todelete2.length == 0) return; // we are ready

      let channels = await lrange("lecture:" + args.lectureuuid + ":channels", 0, -1);

      let channelwatch = channels.map((el) => ("lecture:" + args.lectureuuid + ":channel:" + el + ":members"));
      console.log("channelwatch", channelwatch);

      if (channelwatch.length > 0) this.redis.watch(channelwatch); // also watch the channelmembers
      // now we are sure they are for deletion start the multi
      let multi = this.redis.multi();
      let deletenotescreens = todelete2.map((el) => ("lecture:" + args.lectureuuid + ":notescreen:" + el));
      multi.del(deletenotescreens); // delete the notescreens 
      // now remove them for them lists of notescreens
      multi.srem("lecture:" + args.lectureuuid + ":notescreens", todelete2);
      // and from the channels
      if (channelwatch.length > 0) todelete2.forEach((notescreen) => channelwatch.forEach((channel) => {
        multi.lrem(channel, 0, notescreen);
      })); // everthings is queued now execute
      let exec = promisify(multi.exec).bind(multi);

      await exec();
    } catch (err) {
      console.log("cleanupNotescreen error ", err);
    }


  }


  connectNotescreen(args) {
    console.log("connectnotepads", args);
    this.lastaccess(args.lectureuuid);
    this.redis.multi().sadd("lectures", args.lectureuuid)
      .sadd("lecture:" + args.lectureuuid + ":notescreens", args.notescreenuuid)
      .hmset("lecture:" + args.lectureuuid + ":notescreen:" + args.notescreenuuid,
        "purpose", args.purpose,
        "name", args.name,
        "active", 1,
        "lastaccess", Date.now()
     /* todo may be we have to add an instance id*/).exec();

    this.redis.hget("lecture:" + args.lectureuuid + ":notescreen:" + args.notescreenuuid, "channel", (err, res) => {
      if (err) console.log("hget connectNotescreen err", err);
      else {//
        let channel;
        if (res) {
          channel = res;
          console.log("already have channel", res);
          this.redis.multi().lrem("lecture:" + args.lectureuuid + ":channel:" + channel + ":members", 0, args.notescreenuuid)
            .lpush("lecture:" + args.lectureuuid + ":channel:" + channel + ":members", args.notescreenuuid)
            .exec((err, ret) => {
              this.emitscreenlists(args);
            }); // just in case, datastructures are broken

        } else {
          this.redis.lrange("lecture:" + args.lectureuuid + ":channels", 0, 1, (err, res) => {
            if (!err) channel = res[0];
            console.log("channel 1", channel);
            if (!channel) {
              channel = this.addNewChannel(args, "notebooks");
            }
            console.log("channel 2", channel);
            this.redis.multi().hset("lecture:" + args.lectureuuid + ":notescreen:" + args.notescreenuuid,
              "channel", channel)
              .lrem("lecture:" + args.lectureuuid + ":channel:" + channel + ":members", 0, args.notescreenuuid)
              .lpush("lecture:" + args.lectureuuid + ":channel:" + channel + ":members", args.notescreenuuid)
              .exec((err, ret) => {
                this.emitscreenlists(args);
              });

          })



        }

      }
    });

    /*  if (this.connectednotepads>1) { // no more than one notepad allowed
        this.connectednotepads=1;
        return false;
      }*/
    return true;
  };

  disconnectNotescreen(args) {
    this.lastaccess(args.lectureuuid);
    //this.redis.srem("lecture:"+args.lectureuuid+":notescreens",0,args.notescreenuuid);
    this.redis.hmset("lecture:" + args.lectureuuid + ":notescreen:" + args.notescreenuuid,
      "active", 0, (err, ret) => {
        this.emitscreenlists(args);
      }); // do not delete, a cleanup job will do this

  };

  updateNotescreenActive(args) {
    this.redis.hmset("lecture:" + args.lectureuuid + ":notescreen:" + args.notescreenuuid,
      "active", 1, "lastaccess", Date.now());
  }



  iterOverNotescreens(args, itfunc) {
    this.redis.smembers("lecture:" + args.lectureuuid + ":notescreens",
      function (err, res) {
        if (err) console.log("smemebers errore iterover", err);
        else if (res) {
          res.forEach(((item) => {

            //console.log("iterOverNoteScreem res", res);
            itfunc(item);



          }).bind(this));
        }
      }.bind(this));
  };


  async getNoteScreens(args, funct) {

    let client = this.redis;
    let smembers = promisify(this.redis.smembers).bind(client);
    let hmget = promisify(this.redis.hmget).bind(client);

    try {
      let screens = await smembers("lecture:" + args.lectureuuid + ":notescreens");
      console.log("our screens", screens);
      let screenret = Promise.all(screens.map(async (el, ind) => {
        let temp = await hmget("lecture:" + args.lectureuuid + ":notescreen:" + el,
          "name", "purpose", "channel", "active", "lastaccess");
        return { name: temp[0], purpose: temp[1], channel: temp[2], active: temp[3], lastaccess: temp[4], uuid: el };
      }));
      let toret = await screenret;
      toret = toret.filter((el) => (el.lastaccess ? ((Date.now() - el.lastaccess) < 20 * 60 * 1000 && el.active != 0) : false));
      return toret;

    } catch (error) {
      console.log("error get Notescreen", error);
      return null;
    }

  };

  async getChannelNoteScreens(args) {
    let client = this.redis;
    let lrange = promisify(this.redis.lrange).bind(client);
    let hmget = promisify(this.redis.hmget).bind(client);


    try {
      let lectprop = hmget("lecture:" + args.lectureuuid, "casttoscreens", "backgroundbw", "showscreennumber");
      let channels = await lrange("lecture:" + args.lectureuuid + ":channels", 0, -1);
      //console.log("channels",channels);
      let channelret = channels.map((el) => (lrange("lecture:" + args.lectureuuid + ":channel:" + el + ":members", 0, -1)));
      //console.log("channelsret",channelret);
      let channeldet = Promise.all(channelret.map(async (el, ind) => {

        let notescreenuuids = await el;
        let channeluuid = channels[ind];
        let channelnotescreens = notescreenuuids.map(async (el2) => {

          let details = hmget("lecture:" + args.lectureuuid + ":notescreen:" + el2,
            "active", "name", "purpose", "channel", "scrollheight", "lastaccess");
          //console.log("details", await details);
          return Promise.all([el2, details]);
        });
        let chandetail = hmget("lecture:" + args.lectureuuid + ":channel:" + channeluuid, "type");


        return Promise.all([channeluuid, Promise.all(channelnotescreens), chandetail]);
      }));
      let temp = await channeldet;
      let toret = temp.map((el) => ({
        channeluuid: el[0],
        notescreens: el[1].map((el2) => ({
          active: el2[1][0], lastaccess: el2[1][5], name: el2[1][1], uuid: el2[0],
          purpose: el2[1][2], channel: el2[1][3], scrollheight: el2[1][4]
        }))//.forEach((el)=>(console.log("prefilter",el,el.active ? (el.active-Date.now()))< 20*60*1000 : false)))
          .filter((el) => (el.lastaccess ? ((Date.now() - el.lastaccess) < 20 * 60 * 1000 && el.active != 0) : false)),
        type: el[2][0]
      }));
      lectprop = await lectprop;
      console.log("channellayout", toret);
      return { channelinfo: toret, casttoscreens: lectprop[0], backgroundbw: lectprop[1], showscreennumber: lectprop[2] };
    } catch (error) {
      console.log(" getChannelNoteScreens", error);
      return null;
    }

  }





  assignNoteScreenToChannel(args) {
    console.log("assignNotePadToChannel", args);
    try {
      // TODO get content of old channel
      this.redis.watch("lecture:" + args.lectureuuid + ":assignable",
        "lecture:" + args.lectureuuid + ":channel:" + args.channeluuid + ":members",
        ((error) => {
          if (error) throw error;
          this.redis.hget("lecture:" + args.lectureuuid + ":notescreen:" + args.notescreenuuid, "channel",
            (err, res) => {
              if (err) throw err;
              let oldchanneluuid = res;
              this.redis.watch("lecture:" + args.lectureuuid + ":channel:" + oldchanneluuid + ":members");
              this.redis.multi()
                .lrem("lecture:" + args.lectureuuid + ":channel:" + oldchanneluuid + ":members", 0, args.notescreenuuid)
                .rpush("lecture:" + args.lectureuuid + ":channel:" + args.channeluuid + ":members", args.notescreenuuid)
                .hmset("lecture:" + args.lectureuuid + ":notescreen:" + args.notescreenuuid,
                  "channel", args.channeluuid,
                  "active", 1, "lastaccess", Date.now()).exec((err, res) => {
                    if (err) throw err;
                    this.emitscreenlists(args);

                  });
            });
        }));


    } catch (error) {
      console.log("assignNotescreenToChannel", error);
    }

  };


}

