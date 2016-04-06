/**
 *  Bathy Check Program
 */

if (process.argv.length < 3) {
  console.log('please input node port[3000 - 3004]');
  console.log(' ex ) node app 3001');
  process.exit(1);
} 

var express = require('express');
var routes = require('./routes');
var http = require('http');
var path = require('path');
var formidable = require('formidable');
var fs = require('fs');
var socketio = require('socket.io');
var jsts = require('jsts');
var moment = require('moment');
var shortid = require('shortid');

var app = express();

// all environments
//app.set('port', process.env.PORT || 3000);
app.set('port', process.env.PORT || process.argv[2]);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.logger('dev'));
app.use(express.json());
app.use(express.urlencoded());
app.use(express.methodOverride());
app.use(app.router);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/jsts', express.static(path.join(__dirname, 'lib')));

//var RESOURCE_DIR = '/root/resource';
var RESOURCE_DIR = path.join(__dirname, 'files');
app.use('/download', express.static(RESOURCE_DIR));

// development only
if ('development' == app.get('env')) {
  app.use(express.errorHandler());
}

var httpServer = http.createServer(app).listen(app.get('port'), function(){
  console.log('Express server listening on port ' + app.get('port'));
});

var maxRoom = 30;
var clients = new Array(maxRoom);

var io = socketio.listen(httpServer);
io.set('log level', 2);
io.sockets.on('connection', function(socket) {

	var myNum = mySocketNum();
	clients[myNum] = socket;
	console.log('connection [' + myNum + ']');

	clients[myNum].emit('myTicket', myNum);

	socket.on('disconnect', function() {
		var myOrgNum = clients.indexOf(socket);
		console.log('disconnect [' + myOrgNum + ']');
		clients[myOrgNum] = '';
	});

});

function mySocketNum() {
	var num = maxRoom;
	for (var i=0 ; i < maxRoom ; i++) {
		if(clients[i] === '' || clients[i] === undefined) {
			num = i;
			break;
		}
	}
	return num;
};

app.get('/', routes.index);
app.post('/upload', function(req, res) {
  var myTicketNum = Number(req.query.myTicket);

  var form = new formidable.IncomingForm();
  var files = {};

  form.uploadDir = RESOURCE_DIR;

  form
  .on('progress', function(bytesReceived, bytesExpected) {
	var processFar = (bytesReceived / bytesExpected * 100).toFixed(0);
	clients[myTicketNum].emit('process', processFar);
  })
  .on('file', function(field, file) {
	var newName = shortid.generate() + '_' + file.name;
	fs.rename(file.path, RESOURCE_DIR + '/' + newName);
	files[field] = newName;
  })
  .on('end', function() {
	clients[myTicketNum].emit('end','upload end!');
	clients[myTicketNum].emit('files', files);
	res.send();
  })
  .on('error', function(err) {
	  console.log(err);
  });

  form.parse(req);
});

app.post('/execute', function(req, res) {
	var myTicketNum = Number(req.body.myTicket);

	var sFile = RESOURCE_DIR + '/' +req.body.selectFile;
	var tFile = RESOURCE_DIR + '/' +req.body.totalFile;

	var now = moment().format('YYYYMMDDHH');
	var sBathyFile = RESOURCE_DIR + '/' + now + '_SBathy_' + req.body.selectFile;
	var aBathyFile = RESOURCE_DIR + '/' + now + '_ABathy_' + req.body.totalFile;
	fs.rename(sFile, sBathyFile);
	fs.rename(tFile, aBathyFile);

	var pErrFile = RESOURCE_DIR + '/' + now + '_PError_' + req.body.selectFile;
	var eErrFile = RESOURCE_DIR + '/' + now + '_EError_' + req.body.selectFile;
	var eTinFile = RESOURCE_DIR + '/' + now + '_ETin_' + getJustName(req.body.selectFile) + '.dat';

	clients[myTicketNum].emit('frmsg', '파일을 읽고있습니다...');
	var selectCoordList = readFromFile(sBathyFile);
	var totalCoordList  = readFromFile(aBathyFile);
	
	var geomFact = new jsts.geom.GeometryFactory();
	var selectCoordArr = selectCoordList.toCoordinateArray();
	var totalCoordArr  = totalCoordList.toCoordinateArray();
	var selectMPoint = geomFact.createMultiPoint(selectCoordArr);
	var totalMPoint  = geomFact.createMultiPoint(totalCoordArr);

	clients[myTicketNum].emit('frmsg', '삼각망을 만들고 있습니다...');
	var sBuilder = new jsts.triangulate.DelaunayTriangulationBuilder();
	
	sBuilder.setSites(selectMPoint);
	var delaunayTriangles = sBuilder.getTriangles(geomFact);
	var delaunayEdges = sBuilder.getEdges(geomFact);

	clients[myTicketNum].emit('frmsg', '삼각망내 오류를 찾고 있습니다...');

	var errPolyList = checkRule('Polygon', delaunayTriangles, totalCoordArr, myTicketNum);
	var errPolyPoint = geomFact.createMultiPoint(errPolyList.toCoordinateArray());

	clients[myTicketNum].emit('errCoord1', '-----Polygon err coordinates-----');
	var polygonFileList = readOrgListFromFile(errPolyList, totalCoordArr, aBathyFile, myTicketNum, 'errCoord1');

	clients[myTicketNum].emit('frmsg', '삼각망 선상 오류를 찾고 있습니다...');
	var errEdgeList = checkRule('EdgeBuf', delaunayEdges, totalCoordArr, myTicketNum);
	var errEdgePoint = geomFact.createMultiPoint(errEdgeList.toCoordinateArray());

	clients[myTicketNum].emit('errCoord2', '-----EdgeBuffer err coordinates-----');
	var edgeFileList = readOrgListFromFile(errEdgeList, totalCoordArr, aBathyFile, myTicketNum, 'errCoord2');

	// file write
	//clients[myTicketNum].emit('frmsg', 'Build result files...');
	clients[myTicketNum].emit('frmsg', '결과파일을 생성 중입니다...');
	buildErrFile(pErrFile, polygonFileList, myTicketNum, 'down1');
	buildErrFile(eErrFile, edgeFileList, myTicketNum, 'down2');
	buildTinFile(eTinFile, delaunayEdges, myTicketNum, 'down3');
	clients[myTicketNum].emit('frmsg', '검출완료');

	// write file log
	var infoFile = RESOURCE_DIR + '/info.txt';
	var fileLog = now + ',' + 
				  app.get('port') + ',' + 
				  getFileName(sBathyFile) + ',' + 
				  getFileName(aBathyFile) + ',' + 
				  getFileName(pErrFile) + ',' + 
				  getFileName(eErrFile) + ',' + 
				  getFileName(eTinFile) + '\n';
	fs.appendFileSync(infoFile, fileLog);
	
	res.render('bathyCheck', {mPoint: selectMPoint, 
					  sDelaunay: delaunayTriangles
					  ,errPolyPoint: errPolyPoint
					  ,errEdgePoint: errEdgePoint
						,fwidth: req.body.fwidth
						,fheight: req.body.fheight
						});
});

function getJustName(str) {
	var n = str.lastIndexOf(".");
	if (n === -1) {
		return str;
	} else {
		return str.substring(0, n);
	}

}

function buildTinFile(file, tinGeom, myTicketNum, emitTo){
	var carisLineHeader = "oppmba\nopixof\noprpof\nopun 99\nopid 2011edu\n";
	var carisLineFooter = "q\nopixon\noprpon\noppmcr\n";
	var tinCount = tinGeom.getNumGeometries();

	if (fs.existsSync(file)){
		fs.unlinkSync(file);
	}

	fs.appendFileSync(file, carisLineHeader);
	for (var i = 0; i < tinCount ; i++){
		var geomTemp = tinGeom.getGeometryN(i);
		var coordList = new jsts.geom.CoordinateList(geomTemp.getCoordinates());

		var eachString = "liap/fc=neatline\nk\n";

		for (var it=coordList.iterator(); it.hasNext();) {
			var tempCoord = it.next();
			eachString += "/ge=" + degee2DMS(tempCoord.y)+"N,"+degee2DMS(tempCoord.x)+"E\n";
		}

		eachString +="c\ny\n";
		var buf = new Buffer(eachString, "utf-8");
		fs.appendFileSync(file, buf);
	}
	fs.appendFileSync(file, carisLineFooter);

	clients[myTicketNum].emit(emitTo, getFileName(file));
};

function degee2DMS(coord) {
	var degree = toFixedFloor(coord, 0);
	var min = Number((coord - degree) * 60);
        min = toFixedFloor(min, 0);
	var sec = ((coord - degree) - (min / 60))*3600;

        var strMin = (min < 10) ? ("0"+min) : (min+"");
        var strSec = (toFixedFloor(sec,0) < 10) ? ("0"+toFixedFloor(sec, 3)) : (toFixedFloor(sec, 3)+"");

        return (degree + "-" + strMin + "-" + strSec);
};

function toFixedFloor(number, precision) {
	var digits = Math.pow(10, precision);
        return (Math.floor(number*digits) / digits);
};

function buildErrFile(file, errDataList, myTicketNum, emitTo){
	if (fs.existsSync(file)){
		fs.unlinkSync(file);
	}
	for (var it=errDataList.iterator(); it.hasNext();) {
		var buf = new Buffer(it.next()+'\n');
		fs.appendFileSync(file, buf);
	}

	clients[myTicketNum].emit(emitTo, getFileName(file));
};

function readOrgListFromFile(errList, totalCoordArr, filepath, myTicketNum, emitTo) {
	var sArr = fs.readFileSync(filepath).toString().trim().split('\n');
	var rtnOrgList = new javascript.util.ArrayList();

	for (var it=errList.iterator(); it.hasNext();) {
		var idx = totalCoordArr.indexOf(it.next());
		rtnOrgList.add(sArr[idx]);

		//console.log(sArr[idx]);
		clients[myTicketNum].emit(emitTo, sArr[idx]);
	}
	return rtnOrgList;
};

function checkRule(geomType, tinGeom, tCoordArr, myTicketNum) {
	var errorCoordList = new jsts.geom.CoordinateList();
	var tinCount = tinGeom.getNumGeometries();
	var tCoordArrCnt = tCoordArr.length;

	for (var i = 0; i < tinCount ; i++){
		var geomTemp = tinGeom.getGeometryN(i);
		//var minZCoord = minCoordinateZ(geomTemp.getCoordinates());
		var minZCoord = minCoordinateZ(geomTemp.getCoordinates());

		if (geomTemp.getGeometryType() !== 'Polygon') {
			bufferParam = new jsts.operation.buffer.BufferParameters();
			bufferB = new jsts.operation.buffer.BufferBuilder(bufferParam);
			geomTemp = bufferB.buffer(geomTemp, 4.0/30.0/3600.0);
		}

		for (var j = 0; j < tCoordArrCnt; j++ )	{
			var r = jsts.algorithm.locate.SimplePointInAreaLocator.containsPointInPolygon(tCoordArr[j], geomTemp);
			if (r === true){
				if( compareZTo(minZCoord, tCoordArr[j]) > 0 ){
					errorCoordList.add(tCoordArr[j]);
					//console.log('['+geomType+'] : tinMin['+minZCoord.z+'] [' + tCoordArr[j].x + ', ' + tCoordArr[j].y + ', ' + tCoordArr[j].z + ']');
					//console.log('['+geomType+'] : tinMin['+minZCoord.z+'] [' + tCoordArr[j].z + ']');
				}
			}
		}
		//var procValue = ((((i+1) / tinCount)*100).toFixed(0)) + '%';
		//clients[myTicketNum].emit('inProcess', 'Inspect ' + geomType + '... ' +procValue);
		var procValue = ((((i+1) / tinCount)*100).toFixed(0));
		clients[myTicketNum].emit('inProcess', procValue);
	}
	return errorCoordList;
};

function minCoordinateZ(coordArray) {
	var minCoord;
	for(var n = 0 ; n < coordArray.length ; n++) {
		if(minCoord === undefined) {
			minCoord = (coordArray[n]).clone();
		} 
		else if(compareZTo(minCoord, coordArray[n]) > 0) {
			minCoord = (coordArray[n]).clone();
		}
	}
	return minCoord;
};

function compareZTo(min, input) {
	if (min.z < input.z) return -1;
	else if (min.z > input.z) return 1;
	return 0;
};

function readFromFile(filepath) {
	var coord = new jsts.geom.CoordinateList();
	var sArr = fs.readFileSync(filepath).toString().trim().split('\n');
	sArr = replaceSpace(sArr);
	for (i in sArr) {
		coord.add(lonlatParsing(sArr[i].split(' ')));
	}
	return coord;
};

function replaceSpace(data) {
	arr =  data.map(function(line) {
		return line.replace(/ +/g, ' ').replace(/^ /g, '');
	});
	return arr;
};

function lonlatParsing(array) {
	var sLat = (array[0].replace('N','')).split('-');
	var sLon = (array[1].replace('E','')).split('-');
        
	var lat = Number(sLat[0]) + Number(sLat[1]) / 60 + Number(sLat[2]) / 3600;
	var lon = Number(sLon[0]) + Number(sLon[1]) / 60 + Number(sLon[2]) / 3600;      
	var bathy = Number(array[2]);

	var coordinate = new jsts.geom.Coordinate(lon, lat, bathy);
        
	return coordinate;
};

function getFileName(path) {
	var sep = path.split('/');
	return sep[sep.length - 1];
}

