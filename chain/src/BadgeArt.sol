// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title BadgeArt: the on-chain port of contract/badge-art.mjs (badge art v1).
/// @notice badge-art.mjs is the oracle. Every byte this library returns must equal
/// what badgeSvg() / badgeMetadata() return for the same inputs, so the element
/// order, attribute order, integer maths and number formatting below follow that
/// file line by line. A change of look is a change to badge-art.mjs first
/// (docs/BADGE-ART.md); this port follows, and the chain parity test proves it.
/// @dev Integers only. Every division is on non-negative integers, so Solidity's
/// truncating `/` is JavaScript's Math.floor. Numbers print as plain decimals
/// (Strings.toString), exactly like a JS template literal prints a safe integer.
library BadgeArt {
    using Strings for uint256;

    // PAPER = #F7F4EA, INK = #161616, RING = #18C8F0 #FF1FC8 #5CF27E #FFE11A.
    // They are spelled out inside the literals below so each piece is one constant.

    string private constant OPEN =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">'
        '<rect width="400" height="400" fill="#F7F4EA"/>';

    string private constant DISCS =
        '<circle cx="208" cy="208" r="172" fill="#161616"/>'
        '<circle cx="200" cy="200" r="172" fill="#F7F4EA" stroke="#161616" stroke-width="6"/>';

    string private constant RING_HEAD =
        '<circle cx="200" cy="200" r="148" fill="none" stroke="';
    string private constant RING_MID =
        '" stroke-width="24" pathLength="100" stroke-dasharray="25 75" transform="rotate(';
    string private constant RING_TAIL = ' 200 200)"/>';

    string private constant INNER_HEAD =
        '<circle cx="200" cy="200" r="160" fill="none" stroke="#161616" stroke-width="4"/>'
        '<circle cx="200" cy="200" r="134" fill="';
    string private constant INNER_TAIL = '" stroke="#161616" stroke-width="4"/>';

    // EMBLEMS[0..3] and PIXEL from badge-art.mjs, with PAPER and INK substituted.
    string private constant EMBLEM_KEY =
        '<circle cx="186" cy="104" r="10" fill="#F7F4EA" stroke="#161616" stroke-width="5"/>'
        '<path d="M196 104H222M212 104V113M220 104V111" fill="none" stroke="#161616" stroke-width="5" stroke-linecap="round"/>';
    string private constant EMBLEM_SPEECH =
        '<rect x="176" y="88" width="30" height="20" rx="6" fill="#F7F4EA" stroke="#161616" stroke-width="4"/>'
        '<rect x="194" y="100" width="30" height="20" rx="6" fill="#F7F4EA" stroke="#161616" stroke-width="4"/>';
    string private constant EMBLEM_ARROW =
        '<path d="M178 104H218M206 92L220 104L206 116" fill="none" stroke="#161616" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>';
    string private constant EMBLEM_HOUSE =
        '<path d="M182 118V100L200 86L218 100V118Z" fill="#F7F4EA" stroke="#161616" stroke-width="4" stroke-linejoin="round"/>';
    string private constant EMBLEM_PIXEL = '<rect x="192" y="96" width="16" height="16" fill="#161616"/>';

    string private constant FIGURE =
        '<circle cx="200" cy="168" r="28" fill="#F7F4EA" stroke="#161616" stroke-width="6"/>'
        '<path d="M146 250C146 216 170 204 200 204C230 204 254 216 254 250Z" fill="#F7F4EA" stroke="#161616" stroke-width="6" stroke-linejoin="round"/>'
        '<rect x="96" y="238" width="208" height="46" rx="12" fill="#161616"/>'
        '<text x="200" y="270" text-anchor="middle" font-family="\'Archivo Black\',\'Arial Black\',sans-serif" font-weight="900" font-size="';
    string private constant LABEL_MID = '" letter-spacing="1" fill="#F7F4EA">';

    string private constant FOOT =
        '</text></g>'
        '<text x="12" y="390" font-family="monospace" font-size="14" fill="#161616">capable</text>'
        '<text x="388" y="390" text-anchor="end" font-family="monospace" font-size="14" fill="#161616">#';
    string private constant CLOSE = "</text></svg>";

    string private constant DESCRIPTION =
        "A soulbound stamp for finishing a capable lesson. It cannot be transferred.";

    /// @notice badgeSvg({seed, name, color, emblem, serial}). Inputs are assumed valid
    /// (validName, validColor, serial < 10^9); the caller checks them.
    function svg(bytes32 seed, string memory name, string memory color, uint8 emblem, uint256 serial)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            OPEN,
            _confetti(seed),
            _seal(seed, color, emblem),
            _label(name),
            string.concat(FOOT, serial.toString(), CLOSE)
        );
    }

    /// @notice badgeMetadata({name, serial, svgBase64}).
    function metadata(string memory name, uint256 serial, string memory svgBase64)
        internal
        pure
        returns (string memory)
    {
        string memory title = _title(name);
        string memory head = string.concat('{"name":"capable: ', title, " #", serial.toString());
        return string.concat(
            string.concat(head, '","description":"', DESCRIPTION, '","image":"data:image/svg+xml;base64,'),
            svgBase64,
            string.concat('","attributes":[{"trait_type":"Trait","value":"', title, '"}]}')
        );
    }

    /// @notice 1–12 of A–Z and space, starting with a letter (badge-art.mjs NAME).
    function validName(string memory name) internal pure returns (bool) {
        bytes memory b = bytes(name);
        if (b.length == 0 || b.length > 12) return false;
        if (!_upper(b[0])) return false;
        for (uint256 i = 1; i < b.length; i++) {
            if (!_upper(b[i]) && b[i] != 0x20) return false;
        }
        return true;
    }

    /// @notice "#RRGGBB" with uppercase hex (badge-art.mjs HEX).
    function validColor(string memory color) internal pure returns (bool) {
        bytes memory b = bytes(color);
        if (b.length != 7 || b[0] != "#") return false;
        for (uint256 i = 1; i < 7; i++) {
            bytes1 c = b[i];
            if (!((c >= "0" && c <= "9") || (c >= "A" && c <= "F"))) return false;
        }
        return true;
    }

    // ten squares in the corners, outside the seal
    function _confetti(bytes32 seed) private pure returns (string memory out) {
        for (uint256 k = 0; k < 10; k++) {
            uint256 st = uint8(seed[20 + k]);
            uint256 size = 6 + ((st / 4) % 3) * 4;
            uint256 corner = st % 4; // CORNERS = [[6,6],[324,6],[6,324],[324,324]]
            uint256 x = (corner % 2 == 1 ? 324 : 6) + (uint8(seed[k]) % (70 - size));
            uint256 y = (corner >= 2 ? 324 : 6) + (uint8(seed[10 + k]) % (70 - size));
            out = string.concat(out, _rect(x, y, size, _confettiColor((st / 12) % 5)));
        }
    }

    function _rect(uint256 x, uint256 y, uint256 size, string memory fill) private pure returns (string memory) {
        string memory s = size.toString();
        return string.concat(
            string.concat('<rect x="', x.toString(), '" y="', y.toString()),
            string.concat('" width="', s, '" height="', s),
            string.concat('" fill="', fill, '"/>')
        );
    }

    function _seal(bytes32 seed, string memory color, uint8 emblem) private pure returns (string memory) {
        uint256 tilt = (355 + (uint8(seed[31]) % 11)) % 360;
        uint256 rot = uint8(seed[30]) % 90;
        string memory open = string.concat('<g transform="rotate(', tilt.toString(), " 200 200)\">", DISCS, _ring(rot));
        return string.concat(open, INNER_HEAD, color, INNER_TAIL, _emblem(emblem), FIGURE);
    }

    /// font-size 24 for names of up to 9 letters, else 18; then the name; the ribbon text stays open for FOOT.
    function _label(string memory name) private pure returns (string memory) {
        return string.concat(bytes(name).length <= 9 ? "24" : "18", LABEL_MID, name);
    }

    function _ring(uint256 rot) private pure returns (string memory) {
        return string.concat(
            _ringPart(0, rot),
            _ringPart(1, rot + 90),
            _ringPart(2, rot + 180),
            _ringPart(3, rot + 270)
        );
    }

    function _ringPart(uint256 i, uint256 angle) private pure returns (string memory) {
        return string.concat(RING_HEAD, _confettiColor(i), RING_MID, angle.toString(), RING_TAIL);
    }

    /// CONFETTI = [...RING, INK]; RING is its first four entries.
    function _confettiColor(uint256 i) private pure returns (string memory) {
        if (i == 0) return "#18C8F0";
        if (i == 1) return "#FF1FC8";
        if (i == 2) return "#5CF27E";
        if (i == 3) return "#FFE11A";
        return "#161616";
    }

    function _emblem(uint8 emblem) private pure returns (string memory) {
        if (emblem == 0) return EMBLEM_KEY;
        if (emblem == 1) return EMBLEM_SPEECH;
        if (emblem == 2) return EMBLEM_ARROW;
        if (emblem == 3) return EMBLEM_HOUSE;
        return EMBLEM_PIXEL;
    }

    /// name.charAt(0) + name.slice(1).toLowerCase(), for names that passed validName.
    function _title(string memory name) private pure returns (string memory) {
        bytes memory b = bytes(name);
        bytes memory t = new bytes(b.length);
        for (uint256 i = 0; i < b.length; i++) {
            t[i] = (i > 0 && _upper(b[i])) ? bytes1(uint8(b[i]) + 32) : b[i];
        }
        return string(t);
    }

    function _upper(bytes1 c) private pure returns (bool) {
        return c >= "A" && c <= "Z";
    }
}
