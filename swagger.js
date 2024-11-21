const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'BLS-Provider',
      version: '1.0.0',
    },
    components: {
      securitySchemes: {
        googleIdToken: { // idToken을 API 키로 사용하는 설정
          type: 'apiKey',
          in: 'header', 
          name: 'Authorization', // 헤더 이름
          description: '토큰을 "Bearer " 접두사와 함께 전달합니다. 토큰은 https://snedu.tetraplace.com/auth'
        }
      }
    }
  },
  apis: [
    './src/**/*.js' ], // API 문서를 생성할 파일 경로
};

let specs;

try {
  specs = swaggerJsdoc(options);
} catch (err) {
  console.error('Error generating Swagger specs:', err);
}

module.exports = { swaggerUi, specs };