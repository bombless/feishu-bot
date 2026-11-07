const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { captureExternalVideo } = require('./rtsp-camera')
const FFMPEG = path.join(__dirname, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const FFMPEG_COMMAND = fs.existsSync(FFMPEG) ? FFMPEG : 'ffmpeg'

function run (command, args, timeoutMs = 15000, allowNonZero = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`摄像头命令超时（${timeoutMs / 1000} 秒）`))
    }, timeoutMs)
    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.on('error', error => {
      clearTimeout(timer)
      reject(new Error(`无法启动 ${command}：${error.message}。请安装 FFmpeg 并确保 ffmpeg 位于 PATH 中。`))
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0 || allowNonZero) resolve({ stdout, stderr })
      else reject(new Error(`摄像头采集失败（退出码 ${code}）：${stderr.trim().slice(-1200) || stdout.trim().slice(-1200) || '未知错误'}`))
    })
  })
}

async function getCameraInputArgs (device) {
  if (process.platform === 'win32') {
    if (!device) {
      const { stderr } = await run(FFMPEG_COMMAND, ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], 15000, true)
      const match = stderr.match(/"([^"]+)"\s+\(video\)/i)
      if (!match) throw new Error('没有检测到摄像头。请检查摄像头连接和 Windows 摄像头权限。')
      device = match[1]
    }
    return ['-f', 'dshow', '-i', `video=${device}`]
  }
  if (process.platform === 'darwin') return ['-f', 'avfoundation', '-i', `${device || '0'}:none`]
  return ['-f', 'v4l2', '-i', device || '/dev/video0']
}

async function capturePhoto (device) {
  const output = path.join(os.tmpdir(), `feishu-photo-${process.pid}-${Date.now()}.jpg`)
  const inputArgs = await getCameraInputArgs(device)
  try {
    await run(FFMPEG_COMMAND, [...inputArgs, '-frames:v', '1', '-q:v', '2', '-y', output], 20000)
    if (!fs.existsSync(output) || fs.statSync(output).size === 0) throw new Error('摄像头没有返回有效画面。')
    return output
  } catch (error) {
    try { fs.rmSync(output, { force: true }) } catch {}
    throw error
  }
}

// Record 10 seconds from the same camera, sampling exactly one output frame per second.
// Keep the MP4 files in the project so two test clips can be compared later.
async function captureVideo (device, prefix = 'vid') {
  const outputDir = path.join(__dirname, 'videos')
  fs.mkdirSync(outputDir, { recursive: true })
  const output = path.join(outputDir, `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`)
  const inputArgs = await getCameraInputArgs(device)
  try {
    await run(FFMPEG_COMMAND, [
      ...inputArgs,
      '-t', '10',
      '-vf', 'fps=1',
      '-an',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y', output
    ], 45000)
    if (!fs.existsSync(output) || fs.statSync(output).size === 0) throw new Error('摄像头没有生成有效视频。')
    return output
  } catch (error) {
    try { fs.rmSync(output, { force: true }) } catch {}
    throw error
  }
}


// Compare adjacent one-second samples. The median suppresses the large first
// difference caused by the initial frame and brief exposure adjustments.
async function analyzeVideoMotion (videoPath, threshold = 6) {
  const { stderr } = await run(FFMPEG_COMMAND, [
    '-hide_banner', '-i', videoPath,
    '-vf', 'fps=1,scale=320:-1,tblend=all_mode=difference,signalstats,metadata=print',
    '-f', 'null', '-'
  ], 20000)
  const scores = [...stderr.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map(match => Number(match[1])).filter(Number.isFinite)
  if (scores.length < 3) throw new Error(`运动分析失败：只取得 ${scores.length} 个有效帧差分数。`)
  const sorted = [...scores].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  return { moving: median >= threshold, score: Number(median.toFixed(3)), threshold, samples: scores }
}

module.exports = { capturePhoto, captureVideo, captureExternalVideo, analyzeVideoMotion }
