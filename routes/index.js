
/*
 * GET home page.
 */

exports.index = function(req, res){
  res.render('index', { title: '선택수심 검증' });
}; 
