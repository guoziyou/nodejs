const express = require("express");
const app = express();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const { execSync } = require('child_process');
const FILE_PATH = process.env.FILE_PATH || './tmp';
const SUB_PATH = process.env.SUB_PATH || 'kele666';
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;
const UUID = process.env.UUID || '917b150d-4e8e-4bd9-bff0-f6ee64d6fffa';
const APP_DOMAIN = process.env.APP_DOMAIN || ''; 
const CFPORT = process.env.CFPORT || 443; // 【保留】PaaS 平台公共 TLS 端口 (通常是 443)
const NAME = process.env.NAME || '';
// 【移除】CFIP 已被移除

// ... (创建文件夹, 随机名, 清理文件等代码保持不变) ...

// 创建运行文件夹
if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH);
  console.log(`${FILE_PATH} is created`);
} else {
  console.log(`${FILE_PATH} already exists`);
}

// 生成随机6位字符文件名
function generateRandomName() {
  const characters = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

// 只保留 webName
const webName = generateRandomName();
let webPath = path.join(FILE_PATH, webName);
let subPath = path.join(FILE_PATH, 'sub.txt');
let configPath = path.join(FILE_PATH, 'config.json');

// 清理历史文件
function cleanupOldFiles() {
  try {
    const files = fs.readdirSync(FILE_PATH);
    files.forEach(file => {
      const filePath = path.join(FILE_PATH, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        // 忽略所有错误，不记录日志
      }
    });
  } catch (err) {
    // 忽略所有错误，不记录日志
  }
}

// 根路由
app.get("/", function(req, res) {
  res.send("Hello world!");
});

// 生成 xr-ay 配置文件
async function generateConfig() {
  const internalAppPort = 8081; // 修复 EADDRINUSE 端口冲突
  const wsPath = "/ws";  // VLESS WS 路径
  const subRoute = SUB_PATH.startsWith('/') ? SUB_PATH : `/${SUB_PATH}`;

  const config = {
    log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
    inbounds: [
      {
        port: PORT, // Xray 监听 PaaS 平台的公共 $PORT
        listen: "0.0.0.0",
        protocol: "vless",
        settings: {
          clients: [{ id: UUID }], 
          decryption: "none",
          fallbacks: [
            {
              // 匹配 VLESS-WS 流量
              path: wsPath,
              dest: 3002
            },
            {
              // 匹配 Express 订阅流量
              path: subRoute, 
              dest: internalAppPort
            },
            {
              // 匹配 Express 根路径流量
              path: "/", 
              dest: internalAppPort
            }
          ]
        },
        streamSettings: {
          network: "tcp",
          security: "none" 
        }
      },
      // 内部 VLESS-WS 侦听器 (由 fallback 转发而来)
      {
        port: 3002,
        listen: "127.0.0.1",
        protocol: "vless",
        settings: { clients: [{ id: UUID }], decryption: "none" },
        streamSettings: { network: "ws", security: "none", wsSettings: { path: wsPath } } 
      }
    ],
    dns: { servers: ["https+local://8.8.8.8/dns-query"] },
    outbounds: [ { protocol: "freedom", tag: "direct" }, {protocol: "blackhole", tag: "block"} ]
  };
  fs.writeFileSync(path.join(FILE_PATH, 'config.json'), JSON.stringify(config, null, 2));

  // 返回内部端口，以便 Express 在其上启动
  return internalAppPort;
}

// 下载对应系统架构的依赖文件
function downloadFile(fileName, fileUrl, callback) {
  const filePath = fileName; 
  
  if (!fs.existsSync(FILE_PATH)) {
    fs.mkdirSync(FILE_PATH, { recursive: true });
  }
  
  const writer = fs.createWriteStream(filePath);

  axios({
    method: 'get',
    url: fileUrl,
    responseType: 'stream',
  })
    .then(response => {
      response.data.pipe(writer);
      writer.on('finish', () => {
        writer.close();
        console.log(`Download ${path.basename(filePath)} successfully`);
        callback(null, filePath);
      });
      writer.on('error', err => {
        fs.unlink(filePath, () => { });
        const errorMessage = `Download ${path.basename(filePath)} failed: ${err.message}`;
        console.error(errorMessage);
        callback(errorMessage);
      });
    })
    .catch(err => {
      const errorMessage = `Download ${path.basename(filePath)} failed: ${err.message}`;
      console.error(errorMessage);
      callback(errorMessage);
    });
}

// 下载并运行依赖文件
async function downloadFilesAndRun() {  
  
  const filesToDownload = getFilesForArchitecture(); // 只下载 xray
  if (filesToDownload.length === 0) {
    console.log(`Can't find a file for the current architecture`);
    return;
  }

  const downloadPromises = filesToDownload.map(fileInfo => {
    return new Promise((resolve, reject) => {
      downloadFile(fileInfo.fileName, fileInfo.fileUrl, (err, filePath) => {
        if (err) {
          reject(err);
        } else {
          resolve(filePath);
        }
      });
    });
  });

  try {
    await Promise.all(downloadPromises);
  } catch (err) {
    console.error('Error downloading files:', err);
    return;
  }
  
  function authorizeFiles(filePaths) {
    const newPermissions = 0o775;
    filePaths.forEach(absoluteFilePath => {
      if (fs.existsSync(absoluteFilePath)) {
        fs.chmod(absoluteFilePath, newPermissions, (err) => {
          if (err) {
            console.error(`Empowerment failed for ${absoluteFilePath}: ${err}`);
          } else {
            console.log(`Empowerment success for ${absoluteFilePath}: ${newPermissions.toString(8)}`);
          }
        });
      }
    });
  }
  const filesToAuthorize = [webPath]; // 只授权 xray
  authorizeFiles(filesToAuthorize);

  //运行xr-ay
  const command1 = `nohup ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`;
  try {
    await exec(command1);
    console.log(`${webName} is running`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch (error) {
    console.error(`web running error: ${error}`);
  }
  
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

// 根据系统架构返回对应的url(硬编码为 amd64)
function getFilesForArchitecture() {
  const baseFiles = [
      { fileName: webPath, fileUrl: "https://github.com/kele35818/nodejs/raw/refs/heads/main/web" },
    ];
  return baseFiles;
}

// 自动获取域名并生成订阅
async function generateSubscription() {
  let appDomain = process.env.APP_DOMAIN || ''; // 优先级1: 检查手动设置的 APP_DOMAIN

  // 优先级2: 如果 APP_DOMAIN 未设置, 尝试从 Cloud Foundry 的 VCAP_APPLICATION 自动检测
  if (!appDomain && process.env.VCAP_APPLICATION) {
    try {
      const vcap = JSON.parse(process.env.VCAP_APPLICATION);
      if (vcap && vcap.application_uris && vcap.application_uris.length > 0) {
        appDomain = vcap.application_uris[0]; // 获取第一个域名
        console.log('Auto-detected domain from VCAP_APPLICATION:', appDomain);
      }
    } catch (e) {
      console.error('Failed to parse VCAP_APPLICATION:', e.message);
    }
  }

  // 如果 appDomain 仍然为空, 则无法生成链接
  if (!appDomain) {
    console.error('Could not determine app domain. Set APP_DOMAIN env variable or ensure VCAP_APPLICATION is available. Skipping link generation.');
    return;
  }

  console.log('Using public host:', appDomain);
  await generateLinks(appDomain); // 使用获取到的域名生成链接

  // 生成 list 和 sub 信息
  async function generateLinks(appDomain) {
    // 恢复: curl 获取ISP信息
    const metaInfo = execSync(
      'curl -sm 5 https://speed.cloudflare.com/meta | awk -F\\" \'{print $26"-"$18}\' | sed -e \'s/ /_/g\'',
      { encoding: 'utf-8' }
    );
    const ISP = metaInfo.trim();
    const nodeName = NAME ? `${NAME}-${ISP}` : ISP;

    return new Promise((resolve) => {
      setTimeout(() => {
        // 【重大修改】将 ${CFIP} 替换为 ${appDomain}
        const subTxt = `
vless://${UUID}@${appDomain}:${CFPORT}?encryption=none&security=tls&sni=${appDomain}&fp=firefox&type=ws&host=${appDomain}&path=%2Fws%3Fed%3D2560#${nodeName}
    `;
        console.log("Subscription Content (Base64):");
        console.log(Buffer.from(subTxt).toString('base64'));
        fs.writeFileSync(subPath, Buffer.from(subTxt).toString('base64'));
        console.log(`${FILE_PATH}/sub.txt saved successfully`);
        
        app.get(`/${SUB_PATH}`, (req, res) => {
          const encodedContent = Buffer.from(subTxt).toString('base64');
          res.set('Content-Type', 'text/plain; charset=utf-8');
          res.send(encodedContent);
        });
        resolve(subTxt);
      }, 2000);
    });
  }
}

// 90s后删除相关文件
function cleanFiles() {
  setTimeout(() => {
    const filesToDelete = [configPath, webPath]; 
    
    if (process.platform === 'win32') {
      exec(`del /f /q ${filesToDelete.join(' ')} > nul 2>&1`, (error) => {
        console.clear();
        console.log('App is running');
        console.log('Thank you for using this script, enjoy!');
      });
    } else {
      exec(`rm -rf ${filesToDelete.join(' ')} >/dev/null 2>&1`, (error) => {
        console.clear();
        console.log('App is running');
        console.log('Thank you for using this script, enjoy!');
      });
    }
  }, 90000); // 90s
}
cleanFiles(); // 在全局调用

// 主运行逻辑
async function startserver() {
  try {
    cleanupOldFiles();
    // 获取 Express 的内部端口
    const internalAppPort = await generateConfig();
    await downloadFilesAndRun();
    await generateSubscription(); 
    
    // 在内部端口上启动 Express
    app.listen(internalAppPort, () => console.log(`Internal http server is running on port:${internalAppPort}!`));

  } catch (error) {
    console.error('Error in startserver:', error);
  }
}
startserver().catch(error => {
  console.error('Unhandled error in startserver:', error);
});