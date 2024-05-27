const { execSync } = require('child_process');

function getVideoDuration(inputFile) {
  try {
    const result = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputFile}"`);
    return parseFloat(result.toString().trim());
  } catch (e) {
    console.error(`Error extracting duration: ${e}`);
    return null;
  }
}

function getVideoResolution(inputFile) {
  try {
    const result = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${inputFile}"`);
    const [width, height] = result.toString().trim().split('x').map(Number);
    return { width, height };
  } catch (e) {
    console.error(`Error extracting resolution: ${e}`);
    return null;
  }
}

function calculateBitrate(fileSizeMb, durationS, audioBitrateKbps = 192) {
  const fileSizeKbit = fileSizeMb * 8192;
  const videoBitrateKbit = fileSizeKbit / durationS - audioBitrateKbps;
  return Math.max(0, videoBitrateKbit);
}

function getFfmpegCommands(conversionType, inputFile, outputFile) {
  const maxSizeMb = conversionType === "nitro" ? 100 : 8;
  const durationS = getVideoDuration(inputFile);
  if (!durationS) return null;

  const videoBitrateKbps = calculateBitrate(maxSizeMb, durationS);
  const { width, height } = getVideoResolution(inputFile);
  const maxWidth = 4096;
  const maxHeight = 1440;

  let scaleOption = "";
  if (width > maxWidth || height > maxHeight) {
    scaleOption = `-vf scale=${maxWidth}:${maxHeight}`;
  }

  const pass1 = `ffmpeg -y -i "${inputFile}" ${scaleOption} -r 60 -c:v h264_nvenc -b:v ${videoBitrateKbps}k -pass 1 -an -f null NUL`;
  const pass2 = `ffmpeg -i "${inputFile}" ${scaleOption} -r 60 -c:v h264_nvenc -b:v ${videoBitrateKbps}k -pass 2 -c:a aac -b:a 192k "${outputFile}"`;

  return { pass1, pass2 };
}

module.exports = { getFfmpegCommands, getVideoDuration };
