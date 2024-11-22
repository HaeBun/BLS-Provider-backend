const express = require('express');
const router = express.Router();

const pool = require('../../util/connectionPool.js'); // connectionPool.js 파일에서 pool 가져오기
console.log('Google Auth POST 라우터에 접근했습니다.');

router.post('/', async (req, res) => {
  console.log('Google Auth POST 라우터에 접근했습니다.');

  const { userName, socialType, socialUid, socialIdToken } = req.body;

  console.log('userName:', userName);
  console.log('socialType:', socialType);
  console.log('socialUid:', socialUid);
  console.log('socialIdToken:', socialIdToken);

  
  try {
    // 1. 사용자 존재 여부 확인
    const rows = await pool.query('SELECT * FROM users WHERE user_social_uid = ?', [socialUid]);

    let user;

    if (rows.length === 0) {
      // 2-1. 신규 사용자: 회원 가입
      await pool.query('INSERT INTO users (user_name, user_social_type, user_social_uid) VALUES (?, ?, ?)', [userName, socialType, socialUid]);

      user = { 
        user_id: result.insertId,
        user_name: userName, 
        user_social_type: socialType, 
        user_social_uid: socialIdToken 
      };
    } else {
      user = rows[0];
    }

    await updateOrCreateAuthToken(user.user_id, user.user_social_uid); 

    // 3. 성공 응답
    res.status(200).send({ message: '로그인 성공' }); 
  } catch (error) {
    console.error(error); 
    res.status(500).send({ message: '로그인 실패' });
  }
});

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

module.exports = router; 