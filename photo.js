const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

function run (command, args, timeoutMs = 15000) {
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
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`摄像头采集失败（退出码 ${code}）：${stderr.trim().slice(-1200) || stdout.trim().slice(-1200) || '未知错误'}`))
    })
  })
}

async function capturePhoto (device) {
  const output = path.join(os.tmpdir(), `feishu-photo-${process.pid}-${Date.now()}.jpg`)
  let inputArgs

  if (process.platform === 'win32') {
    if (!device) {
      const { stderr } = await run('ffmpeg', ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'])
      const match = stderr.match(/"([^"]+)"\s+\(video\)/i)
      if (!match) throw new Error('没有检测到摄像头。请检查摄像头连接和 Windows 摄像头权限。')
      device = match[1]
    }
    inputArgs = ['-f', 'dshow', '-i', `video=${device}`]
  } else if (process.platform === 'darwin') {
    inputArgs = ['-f', 'avfoundation', '-i', `${device || '0'}:none`]
  } else {
    inputArgs = ['-f', 'v4l2', '-i', device || '/dev/video0']
  }

  try {
    await run('ffmpeg', [...inputArgs, '-frames:v', '1', '-q:v', '2', '-y', output], 20000)
    if (!fs.existsSync(output) || fs.statSync(output).size === 0) {
      throw new Error('摄像头没有返回有效画面。')
    }
    return output
  } catch (error) {
    try { fs.rmSync(output, { force: true }) } catch {}
    throw error
  }
}

module.exports = { capturePhoto }
