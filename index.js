// 종속성 선언 
const express = require('express');
const session = require('express-session');
const app = express();

const cors = require('cors');
const exceljs = require('exceljs');

const multer = require('multer');
const upload = multer(); 

const axios = require('axios');

// import 선언
const { swaggerUi, specs } = require('./swagger.js'); 
const pool = require('./util/connectionPool.js');
const authGoogle = require('./src/auth/google.js');
const sessionConfig = require('./util/sessionAuth.js');

// web ejs 선언
app.set('view engine', 'ejs'); // EJS 템플릿 엔진 설정
app.set('views', __dirname + '/views'); // 뷰 파일이 있는 디렉토리 설정

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // URL-encoded body 파싱
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));


app.use(cors({
  origin: true, // 클라이언트 도메인 (여러 도메인 허용 가능)
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', // 허용할 HTTP 메서드
  credentials: true // 쿠키 등의 자격 증명 허용
}));

app.use(sessionConfig);
app.use('/images', express.static('/home/node/src/images')); 

app.post('/play', async (req, res) => {
  console.log('/play 접근');
  const videoId = req.query.videoId || 'cf8Mm1Dyi7U'; // 쿼리 파라미터가 없으면 기본 videoId 사용
  const startTime = req.query.startTime || 0; // 쿼리 파라미터가 없으면 0 사용
  const authorization = req.body.authorization || '없음'; // 쿼리 파라미터가 없으면 0 사용

  console.log(videoId);
  console.log(startTime);
  console.log(authorization);

  res.render('play', { videoId: videoId, startSeconds: startTime, authorization: authorization, currentPage: 'play' });
});

app.get('/video_upload', async (req, res) => {
  res.render('video_upload', { title : 'EJS 예제'}); // video.ejs 템플릿 렌더링
});

app.get('/home', (req, res, next) => {
  req.method = 'POST'; // req.method를 POST로 변경

  if(req.query.code) {
    req.body.authorization = req.query.code;
  }
  next(); // app.post 라우터로 제어를 넘김
});

app.post('/home', async (req, res) => {
  let authorization = req.body.authorization;
  console.log("authorization", authorization);
  console.log("req.session.authorization = ", req.session.authorization);
  console.log("req.query.code = ", req.query.code);

  if(req.query.code) {
    authorization = req.query.code;
    req.body.authorization = authorization; // req.body.authorization에 값 할당
  }
console.log(req.body.authorization);
console.log(req.session.socialIdToken);

if (authorization) {
  try {
    const token = authorization.split(' ')[1]; 
    console.log('token:', token);

    const rows = await pool.query('SELECT * FROM auths WHERE id_token = ?', [token]);

    if (rows.length > 0) {
      const tokenCreatedAt = new Date(rows[0].created_at); 
      const now = new Date();
      const diff = now.getTime() - tokenCreatedAt.getTime(); // 밀리초 단위 차이
      const diffHours = Math.floor(diff / (1000 * 60 * 60)); // 시간으로 변환

      if (diffHours < 3) { // 3시간 이내인 경우
        console.log('authorization:', authorization);
        console.log('세션:', req.body);

        const userId = rows[0].user_id;
        const userRows = await pool.query('SELECT user_name FROM users WHERE user_id = ?', [userId]);

        const userName = userRows[0].user_name;

        // 비디오 정보 가져오기
        const videoRows = await pool.query('SELECT * FROM videos');
        const videos = videoRows;

        // 사용자의 시청 기록 가져오기
        const viewRows = await pool.query('SELECT * FROM views WHERE user_id = ?', [userId]);
        const views = viewRows;

        // 각 비디오별 시청률 계산
        const watchedVideos = videos.map(video => {
          const view = views.find(view => view.video_id === video.video_id);
          const percentage = view ? Math.round((view.current_view_duration / video.video_duration) * 100) : 0;
          return { ...video, percentage };
        });

        // 전체 시청률 계산
        const totalDuration = videos.reduce((sum, video) => sum + video.video_duration, 0);
        const totalWatchedDuration = watchedVideos.reduce((sum, video) => sum + (video.percentage / 100 * video.video_duration), 0);
        const overallPercentage = Math.round((totalWatchedDuration / totalDuration) * 100);

        // 2. user_name을 render에 추가
        res.render('home', { 
          authorization: authorization, 
          userName: userName,
          currentPage: 'home',
          overallPercentage: overallPercentage
        });

      } else {
        console.log('토큰 만료');
        res.redirect('/'); // 토큰 만료 시 루트 경로로 리다이렉션
      }
    }
    else {
      console.log('DB에 토큰이 존재하지 않습니다.');
      res.redirect('/'); // DB에 토큰이 없는 경우 루트 경로로 리다이렉션
    }
  }
  catch(error) {
    console.error('토큰 추출 오류:', error);
    res.redirect('/'); // 토큰 추출 오류 시 루트 경로로 리다이렉션
  }
} else {
  // socialIdToken이 존재하지 않는 경우
  console.log('authorization 없습니다.');
  res.redirect('/'); // '/' 경로로 리다이렉션
}
});

app.post('/video_upload', upload.none(), async (req, res) => {
  try {
    const { title, content, youtubeUrl, videoDuration } = req.body;

    // video_uid 중복 확인
    const checkSql = `SELECT COUNT(*) AS cnt FROM videos WHERE video_uid = ?`;
    const checkParams = [youtubeUrl]; 
    const [checkResult] = await pool.query(checkSql, checkParams);

    if (checkResult.length > 0) {
      return res.status(400).send('이미 존재하는 비디오입니다.');
    }

    // 중복되지 않은 경우 삽입
    const sql = `INSERT INTO videos (video_title, video_description, video_uid, video_duration) VALUES (?, ?, ?, ?)`;
    const params = [title, content, youtubeUrl, videoDuration];

    pool.query(sql, params, (err, result) => {
      if (err) {
        console.error('비디오 정보 저장 실패:', err);
        return res.status(500).send('비디오 정보 저장 실패');
      } else {
        console.log('비디오 정보 저장 성공');
        return res.status(200).send({ message: '영상을 업로드했습니다.', result: result }); // 결과 데이터 함께 전송
      }
    });

  } catch (error) {
    console.error('에러 발생:', error);
    return res.status(500).send('서버 오류 발생');
  }
});

// 루트 경로 핸들러
app.get('/', async (req, res) => {
  let code = req.query.code; // 인증 코드

  console.log('code :' + code);
  console.log('token :' + req.session.socialIdToken);

  if (req.session.socialIdToken) {
    code = req.session.socialIdToken;
  }

  const firebaseAuth = require('./util/auth/firebaseAuth.js');
  const kakaoAuth = require('./util/auth/kakaoAuth.js');

  if(code != null) {
    // 인증 코드를 받았을 때
    const REDIRECT_URI = 'https://snedu.tetraplace.com';

    try {
      // 1. 카카오 토큰 발급
      const tokenResponse = await axios.post(
        'https://kauth.kakao.com/oauth/token',
        null, 
        {
          params: {
            grant_type: 'authorization_code',
            client_id: 'db2314090ddcbd541a1cf2e243995a6f', 
            redirect_uri: REDIRECT_URI,
            code: code,
          },
        });
        const accessToken = tokenResponse.data.access_token;
  
        // 2. 카카오 사용자 정보 조회
        const userResponse = await axios.get('https://kapi.kakao.com/v2/user/me', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const kakaoUser = userResponse.data;
  
        // 3. 사용자 정보를 변수에 저장
        const userName = kakaoUser.properties.nickname;
        const socialType = 'kakao';
        const socialUid = kakaoUser.id; 
  
        // 4. 사용자 존재 여부 확인
        const user = await findOrCreateUser(userName, socialType, socialUid);
    
        // 5. auths 테이블에 accessToken 추가 또는 업데이트
        await updateOrCreateAuthToken(user.user_id, accessToken);
        
        // res.render('home', { 
        //   authorization: `Bearer ${accessToken}`, 
        //   userName: userName 
        // });
        res.redirect(`/home?code=${"bearer " + accessToken}`); // /home 경로로 code 값을 쿼리 파라미터로 전달

      } catch (error) {
        console.error(error);
        // 오류 처리 (예: 에러 페이지 표시)
      }
  }
  else {
    res.render('sign_in', { 
      title : 'Student Nurse Education | BLS Provider 심폐소생술 교육 프로그램',
      firebase : firebaseAuth,
      kakao : kakaoAuth
    }); 
  }
});

app.post('/', async (req,res) => {
  req.method = 'GET'; // req.method를 GET으로 변경
  res.redirect('/');
});

app.get('/auth/google', (req, res) => {
  console.log('Google Auth 라우터에 접근했습니다.');
});

app.post('/auth/google', async (req, res) => {
  console.log('Google Auth POST 라우터에 접근했습니다.');

  const { userName, socialType, socialUid, socialIdToken } = req.body;
  
  try {
    // 1. 사용자 존재 여부 확인
    const rows = await pool.query('SELECT * FROM users WHERE user_social_uid = ?', [socialUid]);
    let user;

    if (rows.length === 0) {
      // 2-1. 신규 사용자: 회원 가입
      const result = await pool.query( // result 변수에 쿼리 실행 결과 할당
        'INSERT INTO users (user_name, user_social_type, user_social_uid) VALUES (?, ?, ?)', [userName, socialType, socialUid]
      );

      user = { 
        user_id: result.insertId,
        user_name: userName, 
        user_social_type: socialType, 
        user_social_uid: socialIdToken 
      };
    } else {
      user = rows[0];
    }

    await updateOrCreateAuthToken(user.user_id, socialIdToken); 
    console.log("세션 저장 : " + socialIdToken);
    req.session.socialIdToken = socialIdToken;
    console.log('세션 확인 : ', req.session);
    
    // 3. 성공 응답
    res.status(200).send({ message: '로그인 성공' , socialIdToken: socialIdToken}); 
  } catch (error) {
    console.error(error); 
    res.status(500).send({ message: '로그인 실패' });
  } 
});

app.get('/video_excel', async (req, res) => {
  const videoId = req.query.video_id; // video_id 값 가져오기

  try {
    // 1. 비디오 정보 조회
    const videoResult = await pool.query(`
      SELECT
        video_id,
        video_title,
        video_description,
        video_uid,
        video_duration,
        created_at
      FROM
        videos
      WHERE
        video_id = ?;
    `, [videoId]);
    const videoData = videoResult; // 첫 번째 행 데이터

    // 2. 조회 정보 조회
    const viewsResult = await pool.query(`
      SELECT
        u.user_id,
        u.user_name,
        vi.current_view_duration,
        vi.viewed_at
      FROM
        views AS vi
      JOIN
        users AS u ON vi.user_id = u.user_id
      WHERE
        vi.video_id = ?;
    `, [videoId]);

    // Excel 워크북 생성
    const workbook = new exceljs.Workbook();
    const worksheet = workbook.addWorksheet('Videos');

    // 헤더 추가
    worksheet.columns = [
      { header: '비디오 ID', key: 'video_id' },
      { header: '비디오 제목', key: 'video_title' },
      { header: '비디오 설명', key: 'video_description' },
      { header: '비디오 UID', key: 'video_uid' },
      { header: '비디오 길이', key: 'video_duration' }
    ];

    // 첫번째 행 색깔 추가
    const firstRow = worksheet.getRow(1);
    firstRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '4169E1' }, // 주황색 배경
      };
      cell.font = {
        color: { argb: 'FFFFFFFF' }, // 흰색 글자
        bold: true,
      };  
    });

    // 필터 추가
    worksheet.autoFilter = {
      from: { row: 4, column: 4 },
      to: { row: 4, column: worksheet.columnCount }
    };

    // 데이터 추가
    let currentRow = 2;
    // 비디오 정보 추가
    worksheet.addRow({ video_id: videoData[0].video_id, video_title: videoData[0].video_title , video_description: videoData[0].video_description, video_uid: videoData[0].video_uid, video_duration: videoData[0].video_duration, }); currentRow++;
    
    // 세 번째 행 색깔 추가
    const thirdRow = worksheet.getRow(3);
    thirdRow.eachCell((cell2) => {
      cell2.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '4169E1' }, // 주황색 배경
      };
      cell2.font = {
        color: { argb: 'FFFFFFFF' }, // 흰색 글자
        bold: true,
      };  
    });

    worksheet.addRow({ 
      video_id: 'No.', 
      video_title: '사용자 ID' , 
      video_description: '사용자 이름', 
      video_uid: '시청시간', 
      video_duration: '시청일자' 
    }); currentRow++;
      
    // 사용자 시청 기록 추가
    viewsResult.forEach((view, index) => {
      worksheet.addRow({ 
        video_id: index+1, 
        video_title: view.user_id , 
        video_description: view.user_name, 
        video_uid: view.current_view_duration, 
        video_duration: view.viewed_at }); currentRow++;
    });

    // Excel 파일 생성 및 다운로드 응답 설정
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=videos.xlsx');
    res.send(buffer);

  } catch (error) {
    console.error('Excel 다운로드 에러:', error);
    res.status(500).send('서버 오류 발생');
  }
});

app.post('/update_views', async (req, res) => {
  const authorization = req.body.authorization.split(' ')[1];
  const videoUid = req.body.videoId;
  let currentViewDuration = req.body.currentViewDuration;

  console.log('update_views 요청 수신:', { authorization, videoUid, currentViewDuration });

  try {
    // 1. authorization을 사용하여 auths 테이블에서 user_id 조회
    const authResults = await pool.query(
      'SELECT user_id FROM auths WHERE id_token = ? ORDER BY created_at DESC LIMIT 1',
      authorization
    );

    console.log('auths 테이블 조회 결과:', authResults);

    if (authResults.length === 0) {
      console.error('user_id를 찾을 수 없음');
      return res.status(404).json({ error: 'user_id를 찾을 수 없음' });
    }

    const userId = authResults[0].user_id;
    console.log('userId:', userId);

    // 2. videoUid를 사용하여 videos 테이블에서 video_id, video_duration 조회
    const videoResults = await pool.query(
      'SELECT video_id, video_duration FROM videos WHERE video_uid = ?',
      videoUid
    );

    console.log('videos 테이블 조회 결과:', videoResults);

    if (videoResults.length === 0) {
      console.error('video_id를 찾을 수 없음');
      return res.status(404).json({ error: 'video_id를 찾을 수 없음' });
    }

    const videoId = videoResults[0].video_id;
    const videoDuration = videoResults[0].video_duration;
    console.log('videoId:', videoId);
    console.log('videoDuration:', videoDuration);


    // 3. 90% 이상 시청 시 100%로 처리
    if (currentViewDuration >= videoDuration * 0.9) {
      currentViewDuration = videoDuration; 
    }

    // 4. user_id, video_id, currentViewDuration을 사용하여 views 테이블에 저장 또는 업데이트
    const viewResults = await pool.query(
      `INSERT INTO views (
        video_id, 
        user_id, 
        current_view_duration, 
        viewed_at
      ) 
      VALUES (
        ?, 
        ?, 
        ?, 
        NOW()
      ) 
      ON DUPLICATE KEY 
      UPDATE 
        current_view_duration = IF( 
          VALUES(current_view_duration) > current_view_duration, 
          VALUES(current_view_duration), current_view_duration
        ), 
        viewed_at = NOW()`,
      [videoId, userId, currentViewDuration]
    );

    console.log('views 테이블 업데이트 결과:', viewResults);
    console.log('시청 정보 저장 성공');
    res.json({ message: '시청 정보 저장 성공'});
  } catch (error) {
    console.error('시청 정보 저장 실패:', error);
    res.status(500).json({ error: '시청 정보 저장 실패' });
  }
});


app.post('/docs', async (req, res) => {
  let authorization = req.body.authorization;
  res.render('docs', { pdfURL : "http://tetraplace.com:9000/seoil-bls-provider/snedu_1.pdf", authorization : authorization, currentPage: 'docs'}); // EJS 템플릿에 전달
});

app.post('/history', async (req, res) => {
  let authorization = req.body.authorization;

  console.log(authorization);
  try {
    // 1. auths 테이블에서 user_id 조회
    const auth = await pool.query('SELECT user_id FROM auths WHERE id_token = ?', [authorization.split(' ')[1]]);
    if (!auth[0]) {
      return res.status(401).send('Unauthorized');
    }
    const userId = auth[0].user_id;

    // 2. videos 목록 전체 조회
    const videos = await pool.query('SELECT * FROM videos');

    // 3. views 테이블에서 사용자의 시청 기록 조회
    const views = await pool.query('SELECT * FROM views WHERE user_id = ?', [userId]);

    // 4. EJS 템플릿에 데이터 전달
    res.render('history', { 
      videos, 
      views,
      authorization: authorization,
      currentPage: 'history' }); 
  } catch (error) {
    console.error('기록 조회 오류:', error);
    res.status(500).send('기록 조회 오류');
  }
});

app.get('/management', async (req, res) => {
  try {
    // 1. 모든 영상 정보 가져오기
    const videos = await pool.query('SELECT * FROM videos');

    // 2. 각 영상별 시청 정보 가져오기
    const viewsPromises = videos.map(async (video) => {
      const views = await pool.query(
        `SELECT 
          v.*, 
          u.user_name 
        FROM 
          views v
        JOIN 
          users u ON v.user_id = u.user_id
        WHERE 
          v.video_id = ?`, 
        [video.video_id]
      );
      return {
        video_id: video.video_id,
        video_title: video.video_title,
        video_duration: video.video_duration, // 영상 길이 추가
        views: views
      };
    });
    const videoViews = await Promise.all(viewsPromises);

    // 3. 각 영상별 시청 정보를 가공하여 필요한 데이터 생성
    const managementData = videoViews.map((videoView) => {
      const totalViews = videoView.views.length;
      const completedViews = videoView.views.filter(view => 
        Math.round((view.current_view_duration / videoView.video_duration) * 100) >= 80 
      ).length; // 80% 이상 시청한 경우 완료로 간주

      const userViews = videoView.views.map(view => ({
        user_name: view.user_name,
        current_view_duration: view.current_view_duration,
        viewed_at: view.viewed_at
      }));

      return {
        video_id : videoView.video_id,
        video_title: videoView.video_title,
        totalViews: totalViews,
        completedViews: completedViews,
        completionRate: Math.round((completedViews / totalViews) * 100) || 0,
        userViews: userViews // 사용자별 시청 정보 추가
      };
    });

    // 4. management.ejs 렌더링
    res.render('management', { managementData }); 
  } catch (error) {
    console.error('영상별 시청 현황 조회 오류:', error);
    res.status(500).send('영상별 시청 현황 조회 오류');
  }
});

// 사용자 찾거나 생성하는 함수
const findOrCreateUser = async (userName, socialType, socialUid) => {
  const rows = await pool.query('SELECT * FROM users WHERE user_social_uid = ?', [socialUid]);
  if (rows.length === 0) {
    // 신규 사용자: 회원 가입
    const result = await pool.query(
      'INSERT INTO users (user_name, user_social_type, user_social_uid) VALUES (?, ?, ?)',
      [userName, socialType, socialUid]
    );
    return { user_id: result.insertId }; 
  } else {
    // 기존 사용자: 로그인 처리
    return rows[0]; 
  }
};

// auths 테이블에 토큰 업데이트 또는 생성하는 함수
const updateOrCreateAuthToken = async (userId, accessToken) => {
  const now = new Date();
  const authRows = await pool.query('SELECT * FROM auths WHERE user_id = ?', [userId]);
  if (authRows.length === 0) {
    // auths 테이블에 레코드가 없는 경우: 새 레코드 추가
    await pool.query('INSERT INTO auths (user_id, id_token, created_at) VALUES (?, ?, ?)', [userId, accessToken, now]);
  } else {
    // auths 테이블에 레코드가 있는 경우: 기존 레코드 업데이트
    await pool.query('UPDATE auths SET id_token = ?, created_at = ? WHERE user_id = ?', [accessToken, now, userId]);
  }
};

// Path Mapping

app.listen(11503, () => {
  console.log(`BLS Provider 실행`);
});
