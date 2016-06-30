
/**
 * Module dependencies.
 */

var express = require('express')
  , routes = require('./routes')
  , user = require('./routes/user')
  , http = require('http')
  , path = require('path')
  , fs = require('fs')
  , session = require('express-session')
  , redis = require('redis')
  //, redis = require('socket.io/node_modules/redis')
  , redisStore = require('connect-redis')(session)
  , redisSocketStore = require('socket.io-redis')
  , socketio = require('socket.io')
  , cluster = require('cluster')
  //, sticky = require('socketio-sticky-session');
  , sticky = require('sticky-session');

var app = express();
// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', __dirname + '/views');
app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');
app.use(express.favicon());
app.use(express.logger('dev'));
app.use(express.bodyParser());
app.use(express.json());
app.use(express.urlencoded());
app.use(express.methodOverride());
app.use(express.cookieParser());

var redisInfo = {
		host : 'localhost',
		port : 6379,
		db: 3,
};


app.use(express.session({
	key: 'sid',
	/*cookie: {
		maxAge: 1000 * 60 * 60
	},*/
	/*cookie: {
		path: '/',
		httpOnly: true,
		maxAge: null,
	},*/
	secret: 'secret',
	store : new redisStore(redisInfo),
	ephemeral: true,
	saveUninitialized: false,
	resave: false,
	unset: 'destroy'
}));
app.use(app.router);
app.use(express.static(path.join(__dirname, '/public')));

// development only
if ('development' == app.get('env')) {
	app.use(express.errorHandler());
}


var numCPUs = require('os').cpus().length;
console.log('cpu length' + numCPUs);


var users = new Object();



if(cluster.isMaster){
	for(var i = 0; i < numCPUs; i++){
		cluster.fork();
	}
}
else {

	console.log(process.pid);
	var client = redis.createClient(redisInfo.port, redisInfo.host);
	var pub = redis.createClient(redisInfo.port, redisInfo.host);
	var sub = redis.createClient(redisInfo.port, redisInfo.host);
	

	var server = http.createServer(app).listen(app.get('port'), function(){
		  console.log('Express server listening on port ' + app.get('port'));
	});

	var io = socketio.listen(server, {
		'store' : new redisSocketStore({
			redis: redis,
			redisPub: pub,
		    redisSub : sub,
		    redisClient : client
		  }),
		 'transports' : ['websocket']

	});
	io.adapter(redisSocketStore(redisInfo));
		
	io.on('connection', function(socket){
		// join
		socket.on('join', function(result){
			
			var make = false;
			if(!io.sockets.adapter.rooms[result.title]){
				make = true;
			}
			socket.leave(socket.room);
			socket.name = result.id;
			socket.join(result.title);
			socket.room = result.title;
			
			users[result.id] = socket.id;
			
			var obj = new Object();
			obj.id= result.id;
			obj.session = socket.id;
			
			
			if(!io.sockets.adapter.rooms[result.title].sockets.id){
				io.sockets.adapter.rooms[result.title].sockets.id = new Object();
			}
			io.sockets.adapter.rooms[result.title].sockets.id[result.id] = socket.id;
			
			if(result.title != '/#wait' && make == true){
				io.sockets.in('/#wait').emit('makeroom', result.title);
			}
			
			io.sockets.in(socket.room).emit('member', io.sockets.adapter.rooms[result.title]);
		});
		
		// chat
		socket.on('message', function(result){
			io.sockets.in(socket.room).emit('message', result);
			console.log(process.pid + ": result");
		});
		
		socket.on('error', function(e){
			
			
		});
		
		socket.onclose = function( reason ){
			
			this.leaveAll();
			
			if(this.adapter.rooms[this.room]){
				if(this.adapter.rooms[this.room].length > 0){
					
					delete io.sockets.adapter.rooms[this.room].sockets.id[socket.name];
					io.sockets.in(this.room).emit('member', io.sockets.adapter.rooms[this.room]);
				
				}
				
			} 
			else {
				var roomlist = io.sockets.adapter.rooms;
				io.sockets.in('/#wait').emit('deleteroom', roomlist);
			}
			delete users[socket.name];
			this.emit('disconnect', reason);
			
		};
		
		// leave
		socket.on('disconnect', function(result){
			//console.log(socket.id);
		});
	});

	app.get('/', function(req, res, next){
		
		if(req.session.user_id){
			res.redirect('http://localhost:3000/wait');
			return;
		}
		var data = {
		};
		res.render('index', data);
	});

	// check id
	app.post('/', function(req, res, next){
		
		var id = req.body.id;
		
		var find = false;
		
		for(var key in users){
			if(key == id){
				find = true;
				break;
			}
		}
		if(!find){
			users[id] = '';
			req.session.user_id = id;
		}
		res.send({result:find});
		
	});

	//create room
	app.post('/create/', function(req, res, next){
		
		var title = req.body.title;
		var roomlist = io.sockets.adapter.rooms;
		var find = false;
		for(var i = 0; i < roomlist.length; i++){
			if(title == roomlist[i]){
				find = true;
				break;
			}
		}
		res.send({result:find});
	});

	// go waitroom
	app.get('/wait', function(req, res, next){
		
		if(req.session.user_id){
			var socket_id = users[req.session.user_id];
			if(io.sockets.sockets[socket_id])
				io.sockets.sockets[socket_id].leaveAll();
			
			//console.log(io.sockets.adapter);
			var roomlist = io.sockets.adapter.rooms;
			var data = {
					'roomlist' : JSON.stringify(roomlist),
					'id' : req.session.user_id
			};
			res.render('wait', data);
		}
		else{
			res.redirect('/');
			return;
		}
		
	});

	// open popup
	app.get('/popup/:page', function(req, res, next){
		
		var page = req.params.page;
		var data = {
		};
		res.render(page + '.html', data);
		
	});

	//go chatroom
	app.get('/chat', function(req, res, next){
		
		var title = req.query.title;
		var data = {
				'title': title,
				'id': req.session.user_id
		};
		res.render('chat', data);
	});

	app.get('/logout', function(req, res, next){
		req.session.destroy();
		res.clearCookie('sid');
		res.redirect('/');
		return;
	});
}





