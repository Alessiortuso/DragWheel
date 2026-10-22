// Formati audio di uscita e relativi codec ffmpeg (usati dagli strumenti audio e video)
const TARGETS = ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aac', 'aiff', 'wma'];
const BITRATES = [96, 128, 160, 192, 256, 320];
const OGG_Q = { 96: 3, 128: 4, 160: 5, 192: 6, 256: 8, 320: 9 };
const LOSSY = ['mp3', 'm4a', 'ogg', 'opus', 'aac', 'wma'];

function codecArgs(fmt, br, o = {}) {
  switch (fmt) {
    case 'mp3': return ['-c:a', 'libmp3lame', '-b:a', `${br}k`, '-id3v2_version', '3'];
    case 'm4a': case 'aac': return ['-c:a', 'aac', '-b:a', `${br}k`];
    case 'wav': return ['-c:a', o.bitDepth === 24 ? 'pcm_s24le' : 'pcm_s16le'];
    case 'aiff': return ['-c:a', o.bitDepth === 24 ? 'pcm_s24be' : 'pcm_s16be'];
    case 'flac': return ['-c:a', 'flac', '-compression_level', '5'];
    case 'ogg': return ['-c:a', 'libvorbis', '-q:a', String(OGG_Q[br] ?? 6)];
    case 'opus': return ['-c:a', 'libopus', '-b:a', `${br}k`];
    case 'wma': return ['-c:a', 'wmav2', '-b:a', `${br}k`];
    default: throw new Error(`formato sconosciuto: ${fmt}`);
  }
}
module.exports = { TARGETS, BITRATES, OGG_Q, LOSSY, codecArgs };
