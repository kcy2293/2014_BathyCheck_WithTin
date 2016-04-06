/* file upload */
var formidable = require('formidable'),
    fs = require('fs'),
	path = require('path');

exports.execute = function(req, res){
	var form = new formidable.IncomingForm(),
		files = [];

	form.uploadDir = path.resolve(__dirname, '../files');


	form
	  .on('progress', function(bytesReceived, bytesExpected) {
		var processFar = (bytesReceived / bytesExpected * 100).toFixed(0);
	//	console.log('Progress so far : ' + processFar + '%');
	})
	  .on('file', function(field, file) {
		fs.rename(file.path, form.uploadDir + '/' + file.name);	
		files.push(file.name);
	})
	  .on('end', function() {
		console.log('upload end!');
		res.redirect('/bathyCheck?sfile='+ files[0] + '&tfile=' + files[1]);
	})

	form.parse(req)
}