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

import { createServer } from "http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import * as redis  from "redis";
import MongoClient from 'mongodb';
import {NoteScreenConnection} from './notepadhandler.js';
import {FailsJWTSigner,FailsJWTVerifier, FailsAssets} from 'fails-components-security';
import {FailsConfig} from 'fails-components-config';
import {CronJob} from 'cron';

let cfg=new FailsConfig();

const redisclient = redis.createClient({detect_buffers: true /* required by notescreen connection*/});

const redisclpub = redisclient.duplicate();
const redisclsub = redisclient.duplicate();

let mongoclient = await MongoClient.connect(cfg.getMongoURL(),{useNewUrlParser: true , useUnifiedTopology: true });
let mongodb =mongoclient.db(cfg.getMongoDB()); 

const server = createServer();


let assets= new FailsAssets( { datadir: cfg.getDataDir(), dataurl: cfg.getURL('data'), webservertype: cfg.getWSType(), privateKey:  cfg.getStatSecret()});


let lecturesecurity=new FailsJWTSigner ({redis: redisclient, type: 'lecture', expiresIn: "10m", secret: cfg.getKeysSecret() });
let screensecurity=new FailsJWTSigner ({redis: redisclient, type: 'screen', expiresIn: "10m", secret: cfg.getKeysSecret() });
let lectureverifier= new FailsJWTVerifier({redis: redisclient, type: 'lecture'} );
let screenverifier= new FailsJWTVerifier({redis: redisclient, type: 'screen'} );



// may be move the io also inside the object, on the other hand, I can not insert middleware anymore

let cors=null;

if (cfg.needCors()) {
  cors={
    origin: cfg.getURL('web'),
    methods: ["GET", "POST"],
   // credentials: true
  };
}

var ioIns = new Server(server,{cors: cors});
var notepadio = ioIns.of('/notepads');
var screenio = ioIns.of('/screens');
var notesio = ioIns.of('/notes');

ioIns.adapter(createAdapter(redisclpub, redisclsub));




var nsconn= new NoteScreenConnection({
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
});

var hkjob=new CronJob('35 * * * * *', ()=>{ 
  console.log("Start house keeping");
  nsconn.houseKeeping();
  console.log("End house keeping");
},null,true); // run it every minute


notepadio.use( lectureverifier.socketauthorize());
notepadio.on('connection',(socket)=>{nsconn.SocketHandlerNotepad.bind(nsconn,socket)();});
screenio.use(screenverifier.socketauthorize());
screenio.on('connection',(socket)=>{nsconn.SocketHandlerScreen.bind(nsconn,socket)();});

notesio.use(()=>{return next(new Error("no Connection possible"));}); // this should not connect to notes


server.listen(cfg.getPort('notepad'),cfg.getHost(),function() {
    console.log('Failsserver listening at http://%s:%s',
        server.address().address, server.address().port);
      });

