/* ==========================================================================
   Minimal QR encoder — byte mode, error-correction level L, versions 1..10.
   Deliberately small: level L gives up to 271 bytes at version 10, and a denser
   symbol than that stops scanning reliably off a screen. Everything needed to
   encode offline lives here; no network, no dependencies.
   Exposes window.qrEncode(text) -> { size, modules: [[boolean]] }
   Reference: ISO/IEC 18004.
   ========================================================================== */
(function (global) {
    'use strict';

    var MAX_VERSION = 10;

    /* version -> [ec codewords per block, [[block count, data codewords], ...]]
       ISO/IEC 18004 Table 9, level L rows for versions 1..10. */
    var LEVEL_L = {
        1: [7, [[1, 19]]],
        2: [10, [[1, 34]]],
        3: [15, [[1, 55]]],
        4: [20, [[1, 80]]],
        5: [26, [[1, 108]]],
        6: [18, [[2, 68]]],
        7: [20, [[2, 78]]],
        8: [24, [[2, 97]]],
        9: [30, [[2, 116]]],
        10: [18, [[2, 68], [2, 69]]]
    };

    /* centre coordinates of the alignment patterns */
    var ALIGNMENT = {
        1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
        6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
    };

    /* 18-bit BCH version information, required from version 7 up */
    var VERSION_INFO = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a9f, 10: 0x0a4d3 };

    var MODE_BYTE = 4;
    var EC_LEVEL_L_BITS = 1; /* L=01, M=00, Q=11, H=10 in the format field */

    /* ----------------------------------------------------------------------
       GF(256) arithmetic with the QR primitive polynomial x^8+x^4+x^3+x^2+1
       ---------------------------------------------------------------------- */
    var EXP = new Uint8Array(512);
    var LOG = new Uint8Array(256);
    (function buildTables() {
        var x = 1;
        for (var i = 0; i < 255; i++) {
            EXP[i] = x;
            LOG[x] = i;
            x <<= 1;
            if (x & 0x100) x ^= 0x11d;
        }
        for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
    })();

    function gfMul(a, b) {
        if (a === 0 || b === 0) return 0;
        return EXP[LOG[a] + LOG[b]];
    }

    /* generator polynomial of degree `degree`, highest power first */
    var GEN_CACHE = {};
    function generatorPoly(degree) {
        if (GEN_CACHE[degree]) return GEN_CACHE[degree];
        var poly = [1];
        for (var i = 0; i < degree; i++) {
            var next = new Array(poly.length + 1).fill(0);
            for (var k = 0; k < poly.length; k++) {
                next[k] ^= poly[k];
                next[k + 1] ^= gfMul(poly[k], EXP[i]);
            }
            poly = next;
        }
        GEN_CACHE[degree] = poly;
        return poly;
    }

    function ecCodewords(data, degree) {
        var gen = generatorPoly(degree);
        var remainder = new Array(degree).fill(0);
        for (var i = 0; i < data.length; i++) {
            var factor = data[i] ^ remainder[0];
            remainder.shift();
            remainder.push(0);
            for (var j = 0; j < degree; j++) {
                remainder[j] ^= gfMul(gen[j + 1], factor);
            }
        }
        return remainder;
    }

    /* ----------------------------------------------------------------------
       Bit stream
       ---------------------------------------------------------------------- */
    function BitBuffer() {
        this.bits = [];
    }

    BitBuffer.prototype.put = function (value, length) {
        for (var i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
    };

    BitBuffer.prototype.length = function () {
        return this.bits.length;
    };

    function utf8Bytes(text) {
        var out = [];
        for (var i = 0; i < text.length; i++) {
            var cp = text.codePointAt(i);
            if (cp > 0xffff) i++;
            if (cp < 0x80) {
                out.push(cp);
            } else if (cp < 0x800) {
                out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
            } else if (cp < 0x10000) {
                out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
            } else {
                out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
            }
        }
        return out;
    }

    function dataCapacity(version) {
        var spec = LEVEL_L[version];
        var total = 0;
        for (var i = 0; i < spec[1].length; i++) total += spec[1][i][0] * spec[1][i][1];
        return total;
    }

    function pickVersion(byteLength) {
        for (var v = 1; v <= MAX_VERSION; v++) {
            /* 4 bits mode + 8/16 bits count, in bits */
            var header = 4 + (v < 10 ? 8 : 16);
            if (byteLength * 8 + header <= dataCapacity(v) * 8) return v;
        }
        return 0;
    }

    function buildDataCodewords(bytes, version) {
        var capacity = dataCapacity(version);
        var buf = new BitBuffer();
        buf.put(MODE_BYTE, 4);
        buf.put(bytes.length, version < 10 ? 8 : 16);
        for (var i = 0; i < bytes.length; i++) buf.put(bytes[i], 8);

        var available = capacity * 8;
        buf.put(0, Math.min(4, available - buf.length())); /* terminator */
        while (buf.length() % 8 !== 0) buf.bits.push(0);

        var codewords = [];
        for (var b = 0; b < buf.bits.length; b += 8) {
            var byte = 0;
            for (var k = 0; k < 8; k++) byte = (byte << 1) | buf.bits[b + k];
            codewords.push(byte);
        }
        var pad = [0xec, 0x11];
        for (var p = 0; codewords.length < capacity; p++) codewords.push(pad[p % 2]);
        return codewords;
    }

    function splitBlocks(codewords, version) {
        var spec = LEVEL_L[version];
        var ecLength = spec[0];
        var groups = spec[1];
        var dataBlocks = [];
        var ecBlocks = [];
        var offset = 0;

        for (var g = 0; g < groups.length; g++) {
            for (var n = 0; n < groups[g][0]; n++) {
                var size = groups[g][1];
                var block = codewords.slice(offset, offset + size);
                offset += size;
                dataBlocks.push(block);
                ecBlocks.push(ecCodewords(block, ecLength));
            }
        }
        return { data: dataBlocks, ec: ecBlocks, ecLength: ecLength };
    }

    function interleave(blocks) {
        var out = [];
        var longest = blocks.reduce(function (max, b) { return Math.max(max, b.length); }, 0);
        for (var i = 0; i < longest; i++) {
            for (var b = 0; b < blocks.length; b++) {
                if (i < blocks[b].length) out.push(blocks[b][i]);
            }
        }
        return out;
    }

    /* ----------------------------------------------------------------------
       Matrix construction
       ---------------------------------------------------------------------- */
    function Matrix(size) {
        this.size = size;
        this.modules = [];
        this.reserved = [];
        for (var r = 0; r < size; r++) {
            this.modules.push(new Array(size).fill(false));
            this.reserved.push(new Array(size).fill(false));
        }
    }

    Matrix.prototype.set = function (row, col, dark) {
        this.modules[row][col] = !!dark;
        this.reserved[row][col] = true;
    };

    Matrix.prototype.inBounds = function (row, col) {
        return row >= 0 && col >= 0 && row < this.size && col < this.size;
    };

    function placeFinder(m, row, col) {
        for (var r = -1; r <= 7; r++) {
            for (var c = -1; c <= 7; c++) {
                if (!m.inBounds(row + r, col + c)) continue;
                var ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
                var dark = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                    (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                    (r >= 2 && r <= 4 && c >= 2 && c <= 4);
                m.set(row + r, col + c, ring <= 3 && dark);
            }
        }
    }

    function placeAlignment(m, version) {
        var centres = ALIGNMENT[version];
        for (var i = 0; i < centres.length; i++) {
            for (var j = 0; j < centres.length; j++) {
                var r = centres[i];
                var c = centres[j];
                /* skip the three spots the finder patterns already cover */
                if ((r === 6 && c === 6) || (r === 6 && c === m.size - 7) || (r === m.size - 7 && c === 6)) continue;
                for (var dr = -2; dr <= 2; dr++) {
                    for (var dc = -2; dc <= 2; dc++) {
                        m.set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
                    }
                }
            }
        }
    }

    function placeTimingAndReserved(m, version) {
        var size = m.size;
        for (var i = 8; i < size - 8; i++) {
            if (!m.reserved[6][i]) m.set(6, i, i % 2 === 0);
            if (!m.reserved[i][6]) m.set(i, 6, i % 2 === 0);
        }
        /* the module that is always dark */
        m.set(size - 8, 8, true);
    }

    function reserveFormatAreas(m, version) {
        var size = m.size;
        var r, c;
        for (var i = 0; i <= 8; i++) {
            if (i !== 6) {
                m.reserved[8][i] = true;
                m.reserved[i][8] = true;
            }
        }
        for (var j = 0; j < 8; j++) {
            m.reserved[8][size - 1 - j] = true;
            m.reserved[size - 1 - j][8] = true;
        }
        if (version >= 7) {
            for (r = 0; r < 6; r++) {
                for (c = size - 11; c <= size - 9; c++) m.reserved[r][c] = true;
            }
            for (c = 0; c < 6; c++) {
                for (r = size - 11; r <= size - 9; r++) m.reserved[r][c] = true;
            }
        }
    }

    function placeData(m, codewords) {
        var size = m.size;
        var bitIndex = 0;
        var total = codewords.length * 8;
        var upward = true;

        for (var col = size - 1; col > 0; col -= 2) {
            if (col === 6) col--; /* straddle the vertical timing pattern */
            for (var count = 0; count < size; count++) {
                var row = upward ? size - 1 - count : count;
                for (var k = 0; k < 2; k++) {
                    var c = col - k;
                    if (m.reserved[row][c]) continue;
                    var bit = 0;
                    if (bitIndex < total) {
                        bit = (codewords[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
                        bitIndex++;
                    }
                    m.modules[row][c] = bit === 1;
                }
            }
            upward = !upward;
        }
    }

    var MASKS = [
        function (r, c) { return (r + c) % 2 === 0; },
        function (r) { return r % 2 === 0; },
        function (r, c) { return c % 3 === 0; },
        function (r, c) { return (r + c) % 3 === 0; },
        function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
        function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; },
        function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; },
        function (r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; }
    ];

    function applyMask(m, mask) {
        var fn = MASKS[mask];
        for (var r = 0; r < m.size; r++) {
            for (var c = 0; c < m.size; c++) {
                if (!m.reserved[r][c] && fn(r, c)) m.modules[r][c] = !m.modules[r][c];
            }
        }
    }

    function bchFormat(value) {
        var v = value << 10;
        var g = 0x537;
        for (var i = 14; i >= 10; i--) {
            if ((v >>> i) & 1) v ^= g << (i - 10);
        }
        return ((value << 10) | v) ^ 0x5412;
    }

    /* Format info runs down column 8 and across row 8, with bit 0 nearest the
       finder; the same 15 bits are mirrored into the other two corners. */
    function placeFormat(m, mask) {
        var bits = bchFormat((EC_LEVEL_L_BITS << 3) | mask);
        var size = m.size;
        var i, bit;

        for (i = 0; i < 15; i++) {
            bit = ((bits >> i) & 1) === 1;
            if (i < 6) m.modules[i][8] = bit;
            else if (i < 8) m.modules[i + 1][8] = bit;
            else m.modules[size - 15 + i][8] = bit;
        }

        for (i = 0; i < 15; i++) {
            bit = ((bits >> i) & 1) === 1;
            if (i < 8) m.modules[8][size - i - 1] = bit;
            else if (i === 8) m.modules[8][7] = bit;
            else m.modules[8][14 - i] = bit;
        }

        m.modules[size - 8][8] = true; /* the always-dark module */
    }

    function placeVersion(m, version) {
        if (version < 7) return;
        var bits = VERSION_INFO[version];
        var size = m.size;
        for (var i = 0; i < 18; i++) {
            var bit = ((bits >> i) & 1) === 1;
            var r = Math.floor(i / 3);
            var c = i % 3;
            m.modules[size - 11 + c][r] = bit;
            m.modules[r][size - 11 + c] = bit;
        }
    }

    /* ----------------------------------------------------------------------
       Mask selection: ISO penalty rules 1..4
       ---------------------------------------------------------------------- */
    function penalty(m) {
        var size = m.size;
        var score = 0;
        var dark = 0;
        var r, c;

        for (var line = 0; line < size; line++) {
            var rowRun = 1;
            var colRun = 1;
            for (c = 0; c < size; c++) {
                if (m.modules[line][c]) dark++;
                if (c > 0) {
                    rowRun = m.modules[line][c] === m.modules[line][c - 1] ? rowRun + 1 : 1;
                    colRun = m.modules[c][line] === m.modules[c - 1][line] ? colRun + 1 : 1;
                }
                if (rowRun === 5) score += 3;
                else if (rowRun > 5) score += 1;
                if (colRun === 5) score += 3;
                else if (colRun > 5) score += 1;
            }
        }

        for (r = 0; r < size - 1; r++) {
            for (c = 0; c < size - 1; c++) {
                var v = m.modules[r][c];
                if (v === m.modules[r][c + 1] && v === m.modules[r + 1][c] && v === m.modules[r + 1][c + 1]) score += 3;
            }
        }

        /* rule 3: a 1:1:3:1:1 finder-like run with four light modules alongside */
        var needle = '1011101';
        for (r = 0; r < size; r++) {
            var rowStr = '';
            var colStr = '';
            for (c = 0; c < size; c++) {
                rowStr += m.modules[r][c] ? '1' : '0';
                colStr += m.modules[c][r] ? '1' : '0';
            }
            score += 40 * countOccurrences(rowStr, '0000' + needle) + 40 * countOccurrences(rowStr, needle + '0000');
            score += 40 * countOccurrences(colStr, '0000' + needle) + 40 * countOccurrences(colStr, needle + '0000');
        }

        var percent = (dark * 100) / (size * size);
        score += 10 * Math.floor(Math.abs(percent - 50) / 5);
        return score;
    }

    function countOccurrences(haystack, needle) {
        var count = 0;
        var at = haystack.indexOf(needle);
        while (at !== -1) {
            count++;
            at = haystack.indexOf(needle, at + 1);
        }
        return count;
    }

    /* ----------------------------------------------------------------------
       Public entry point
       ---------------------------------------------------------------------- */
    function encode(text) {
        var bytes = utf8Bytes(String(text));
        var version = pickVersion(bytes.length);
        if (!version) return null; /* beyond version 10 / level L capacity */

        var blocks = splitBlocks(buildDataCodewords(bytes, version), version);
        var codewords = interleave(blocks.data);
        var ecAll = interleave(blocks.ec);
        var stream = codewords.concat(ecAll);

        var size = version * 4 + 17;
        var best = null;
        for (var mask = 0; mask < 8; mask++) {
            var m = new Matrix(size);
            placeFinder(m, 0, 0);
            placeFinder(m, size - 7, 0);
            placeFinder(m, 0, size - 7);
            placeAlignment(m, version);
            placeTimingAndReserved(m, version);
            reserveFormatAreas(m, version);
            placeData(m, stream);
            applyMask(m, mask);
            placeFormat(m, mask);
            placeVersion(m, version);
            var score = penalty(m);
            if (!best || score < best.score) best = { score: score, matrix: m, mask: mask };
        }

        return {
            size: size,
            version: version,
            mask: best.mask,
            modules: best.matrix.modules,
            bytes: bytes.length
        };
    }

    global.qrEncode = encode;
    global.qrMaxBytes = dataCapacity(MAX_VERSION);
})(typeof window !== 'undefined' ? window : this);
