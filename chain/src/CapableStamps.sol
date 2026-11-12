// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {BadgeArt} from "./BadgeArt.sol";

/// @title ERC-5192: minimal soulbound NFTs.
interface IERC5192 {
    /// @notice Emitted when the locking status is changed to locked.
    event Locked(uint256 tokenId);
    /// @notice Emitted when the locking status is changed to unlocked.
    event Unlocked(uint256 tokenId);
    /// @notice Returns the locking status of a token. Reverts for a token that does not exist.
    function locked(uint256 tokenId) external view returns (bool);
}

/// @title CapableStamps: soulbound stamps for finishing a capable lesson.
/// @notice Free to mint (the minter pays gas), one per (holder, trait), never
/// transferable. The holder may burn their own stamp, and may mint that trait
/// again later (a new token, a new seed). Art and metadata are fully on chain.
///
/// Honor system: the app offers a mint only after the lesson's trait is earned
/// in the reader's browser. This contract cannot check that, and does not try.
///
/// The owner can only add traits and open or close them. The owner cannot mint
/// for anyone, move or burn anyone's stamp, change a trait once added, or change
/// the art. There is no proxy and no upgrade path.
contract CapableStamps is ERC721, Ownable2Step, IERC5192 {
    struct Trait {
        string name; // "SOVEREIGN", as printed on the ribbon
        string color; // "#RRGGBB" uppercase, fills the inner disc
        uint8 emblem; // 0 key, 1 speech, 2 arrow, 3 house, else a pixel
        bool open; // minting allowed
    }

    struct Stamp {
        bytes32 seed; // keccak256(abi.encodePacked(holder, stampId, tokenId)), fixed at mint
        uint8 stampId;
        uint16 index; // position in _owned[holder]
    }

    /// @notice Highest token id. The art prints serials below 10^9.
    uint256 public constant MAX_TOKEN_ID = 999_999_999;

    Trait[] private _traits;
    mapping(uint256 tokenId => Stamp) private _stamps;
    mapping(address holder => mapping(uint8 stampId => uint256 tokenId)) private _held; // 0 = none
    mapping(address holder => uint256[] tokenIds) private _owned;
    uint256 private _lastId;

    event Stamped(address indexed holder, uint8 indexed stampId, uint256 indexed tokenId);
    event TraitAdded(uint8 indexed stampId, string name, string color, uint8 emblem);
    event TraitOpenSet(uint8 indexed stampId, bool open);

    /// @notice Stamps never move: transfers and approvals always revert.
    error Soulbound();
    error UnknownTrait(uint8 stampId);
    error TraitClosed(uint8 stampId);
    error AlreadyHeld(uint8 stampId);
    error NotHolder(uint256 tokenId);
    error InvalidName();
    error InvalidColor();
    error InvalidSerial();
    error TooManyTraits();
    error SupplyExhausted();

    constructor() ERC721("capable stamps", "STAMP") Ownable(msg.sender) {
        // The four founding traits, stampIds 0-3, in content/app.meta.json order. All open.
        _setOpen(_addTrait("SOVEREIGN", "#18C8F0", 0), true);
        _setOpen(_addTrait("CIVIL", "#FF1FC8", 1), true);
        _setOpen(_addTrait("MOBILE", "#5CF27E", 2), true);
        _setOpen(_addTrait("ENDURING", "#FFE11A", 3), true);
    }

    // ─────────────────────────── stamps ───────────────────────────

    /// @notice Mint your stamp for `stampId`. Free; one per (holder, trait).
    function mint(uint8 stampId) external returns (uint256 tokenId) {
        if (stampId >= _traits.length) revert UnknownTrait(stampId);
        if (!_traits[stampId].open) revert TraitClosed(stampId);
        if (_held[msg.sender][stampId] != 0) revert AlreadyHeld(stampId);
        tokenId = _lastId + 1;
        if (tokenId > MAX_TOKEN_ID) revert SupplyExhausted();
        _lastId = tokenId;

        _stamps[tokenId] = Stamp({
            seed: keccak256(abi.encodePacked(msg.sender, stampId, tokenId)),
            stampId: stampId,
            index: uint16(_owned[msg.sender].length)
        });
        _held[msg.sender][stampId] = tokenId;
        _owned[msg.sender].push(tokenId);

        _mint(msg.sender, tokenId);
        emit Locked(tokenId);
        emit Stamped(msg.sender, stampId, tokenId);
    }

    /// @notice Burn your own stamp. Only its holder can. You may mint that trait again later.
    function burn(uint256 tokenId) external {
        if (_ownerOf(tokenId) != msg.sender) revert NotHolder(tokenId);
        Stamp memory s = _stamps[tokenId];
        delete _held[msg.sender][s.stampId];

        uint256[] storage list = _owned[msg.sender];
        uint256 last = list[list.length - 1];
        if (last != tokenId) {
            list[s.index] = last;
            _stamps[last].index = s.index;
        }
        list.pop();
        delete _stamps[tokenId];

        _burn(tokenId);
    }

    /// @notice ERC-5192: every stamp is locked. Reverts for a token that does not exist.
    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    function stampOf(uint256 tokenId) external view returns (uint8) {
        _requireOwned(tokenId);
        return _stamps[tokenId].stampId;
    }

    function seedOf(uint256 tokenId) external view returns (bytes32) {
        _requireOwned(tokenId);
        return _stamps[tokenId].seed;
    }

    function hasStamp(address holder, uint8 stampId) external view returns (bool) {
        return _held[holder][stampId] != 0;
    }

    /// @notice The holder's token ids. Order is not meaningful (a burn moves the last one into the gap).
    function tokensOf(address holder) external view returns (uint256[] memory) {
        return _owned[holder];
    }

    /// @notice data:application/json;base64 metadata whose image is the on-chain SVG.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        Stamp memory s = _stamps[tokenId];
        Trait storage t = _traits[s.stampId];
        string memory image = BadgeArt.svg(s.seed, t.name, t.color, t.emblem, tokenId);
        string memory json = BadgeArt.metadata(t.name, tokenId, Base64.encode(bytes(image)));
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @notice The art for any input, exactly as contract/badge-art.mjs badgeSvg() draws it.
    /// Reverts where badgeSvg() throws (bad name, colour or serial).
    function render(bytes32 seed, string calldata name, string calldata color, uint8 emblem, uint256 serial)
        external
        pure
        returns (string memory)
    {
        if (!BadgeArt.validName(name)) revert InvalidName();
        if (!BadgeArt.validColor(color)) revert InvalidColor();
        if (serial > MAX_TOKEN_ID) revert InvalidSerial();
        return BadgeArt.svg(seed, name, color, emblem, serial);
    }

    // ─────────────────────────── traits ───────────────────────────

    /// @notice Register a trait. It starts closed: open it with setOpen when its lesson ships.
    function addTrait(string calldata name, string calldata color, uint8 emblem)
        external
        onlyOwner
        returns (uint8 stampId)
    {
        return _addTrait(name, color, emblem);
    }

    function setOpen(uint8 stampId, bool open) external onlyOwner {
        if (stampId >= _traits.length) revert UnknownTrait(stampId);
        _setOpen(stampId, open);
    }

    function traitCount() external view returns (uint256) {
        return _traits.length;
    }

    function traitOf(uint8 stampId)
        external
        view
        returns (string memory name, string memory color, uint8 emblem, bool open)
    {
        if (stampId >= _traits.length) revert UnknownTrait(stampId);
        Trait storage t = _traits[stampId];
        return (t.name, t.color, t.emblem, t.open);
    }

    function _addTrait(string memory name, string memory color, uint8 emblem) private returns (uint8 stampId) {
        if (!BadgeArt.validName(name)) revert InvalidName();
        if (!BadgeArt.validColor(color)) revert InvalidColor();
        if (_traits.length > type(uint8).max) revert TooManyTraits();
        stampId = uint8(_traits.length);
        _traits.push(Trait({name: name, color: color, emblem: emblem, open: false}));
        emit TraitAdded(stampId, name, color, emblem);
    }

    function _setOpen(uint8 stampId, bool open) private {
        _traits[stampId].open = open;
        emit TraitOpenSet(stampId, open);
    }

    // ─────────────────────────── soulbound ───────────────────────────

    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    function transferFrom(address, address, uint256) public pure override {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256, bytes memory) public pure override {
        revert Soulbound();
    }

    /// @dev Defence in depth: only mint (from 0) and burn (to 0) may change an owner.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC5192).interfaceId || super.supportsInterface(interfaceId);
    }
}
