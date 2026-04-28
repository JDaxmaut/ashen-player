const fs = require('fs');

const size = 32;
const png = Buffer.alloc(8 + 25 + 12 + (size * size * 4 + size * size / 8));

let offset = 0;

png.writeUInt32BE(0x89504E47, offset); offset += 4;
png.writeUInt32BE(0x0D0A1A0A, offset); offset += 4;

png.writeUInt32BE(0x0000000D, offset); offset += 4;
png.writeUInt8(0x49, offset++); png.writeUInt8(0x48, offset++); png.writeUInt8(0x44, offset++); png.writeUInt8(0x52, offset++);

png.writeUInt32BE(0x00000020, offset); offset += 4;
png.writeUInt32BE(0x00000020, offset); offset += 4;
png.writeUInt8(8, offset++);
png.writeUInt8(6, offset++);
png.writeUInt8(0, offset++);
png.writeUInt8(0, offset++);
png.writeUInt8(0, offset++);

png.writeUInt32BE(0x52474449, offset); offset += 4;
png.writeUInt32BE(0xFFFFFFFF, offset); offset += 4;
png.writeUInt32BE(0x00000000, offset); offset += 4;
png.writeUInt32BE(0x00000000, offset); offset += 4;

png.writeUInt32BE(0x4945444E, offset); offset += 4;
png.writeUInt32BE(0x00000000, offset); offset += 4;

png.writeUInt32BE(0x49454E44, offset); offset += 4;
png.writeUInt32BE(0xAE426082, offset); offset += 4;

fs.writeFileSync('icon.png', png);
console.log('Created icon.png');