'use strict'

const { saveEnv } = require('./env-util')

saveEnv().catch(error => {
  console.error('保存环境变量失败:', error.message || error)
  process.exitCode = 1
})
