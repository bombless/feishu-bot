'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { getRtspUrl } = require('./rtsp-camera')

const FFMPEG = path.join(__dirname, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const FFMPEG_COMMAND = fs.existsSync(FFMPEG) ? FFMPEG : 'ffmpeg'

function run (args, timeoutMs = 45000, allowNonZero = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_COMMAND, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error(`音频采集超时（${timeoutMs / 1000} 秒）`)) }, timeoutMs)
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-12000) })
    child.once('error', error => { clearTimeout(timer); reject(new Error(`无法启动 FFmpeg：${error.message}。请检查 FFmpeg 是否安装。`)) })
    child.once('close', code => {
      clearTimeout(timer)
      if (code === 0 || allowNonZero) resolve(stderr)
      else reject(new Error(`音频采集失败（退出码 ${code}）：${stderr.slice(-1600) || '未知错误'}`))
    })
  })
}

async function getMicrophoneInputArgs (device) {
  if (process.platform === 'win32') {
    if (!device) {
      const stderr = await run(['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], 15000, true)
      const match = stderr.match(/"([^"]+)"\s+\(audio\)/i)
      if (!match) throw new Error('没有检测到本机麦克风。请检查麦克风连接和 Windows 麦克风权限，也可使用 audio 0 "设备名称" 指定设备。')
      device = match[1]
    }
    return ['-f', 'dshow', '-i', `audio=${device}`]
  }
  if (process.platform === 'darwin') return ['-f', 'avfoundation', '-i', `:${device || '0'}`]
  return ['-f', 'alsa', '-i', device || 'default']
}

async function captureAudio (sourceId = '0', device) {
  const outputDir = path.join(__dirname, 'videos', 'audio')
  fs.mkdirSync(outputDir, { recursive: true })
  const output = path.join(outputDir, `audio-${sourceId}-${new Date().toISOString().replace(/[:.]/g, '-')}.opus`)
  try {
    const inputArgs = sourceId === '1'
      ? ['-rtsp_transport', 'tcp', '-i', await getRtspUrl()]
      : await getMicrophoneInputArgs(device)
    await run([
      '-hide_banner', ...inputArgs, '-map', '0:a:0', '-vn', '-t', '10',
      '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k',
      '-application', 'voip', '-y', output
    ], sourceId === '1' ? 90000 : 45000)
    if (!fs.existsSync(output) || fs.statSync(output).size === 0) throw new Error('没有生成有效音频文件；请确认所选音源包含音频轨道。')
    return output
  } catch (error) {
    try { fs.rmSync(output, { force: true }) } catch {}
    throw error
  }
}

module.exports = { captureAudio }
