// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint32, ebool, externalEuint32} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title FHE Sealed-Bid Auction (demo)
/// @notice Nhận bid đã mã hoá, chọn người thắng bằng so sánh bí mật (không lộ giá),
///         lưu kết quả ở dạng encrypted và cấp quyền giải mã off-chain (giống pattern FHECounter).
contract FHEAuction is SepoliaConfig {
    using FHE for *;

    // --- Metadata phiên đấu giá ---
    address public seller;
    string public item;
    uint256 public biddingEnd;
    bool public settled;

    // --- Dữ liệu bids (mã hoá) ---
    mapping(address => euint32) private encBids;
    mapping(address => bool) public hasBid;

    // --- Kết quả mã hoá (không giải mã on-chain) ---
    euint32 public winningBidEnc;    // giá thắng (encrypted)
    euint32 public winningIndexEnc;  // index winner trong mảng truyền vào khi settle (encrypted)

    event BidSubmitted(address indexed bidder);
    event Settled(); // plaintext sẽ hiển thị off-chain sau khi decrypt

    constructor(string memory _item, uint256 _biddingDurationSeconds) {
        seller = msg.sender;
        item = _item;
        biddingEnd = block.timestamp + _biddingDurationSeconds;
    }

    modifier onlySeller() {
        require(msg.sender == seller, "not seller");
        _;
    }

    modifier beforeEnd() {
        require(block.timestamp < biddingEnd, "bidding ended");
        _;
    }

    modifier afterEnd() {
        require(block.timestamp >= biddingEnd, "bidding not ended");
        _;
    }

    /// @notice Gửi bid mã hoá từ client (encrypted handle + proof)
    /// @dev KHỚP CHUẨN với FHECounter: externalEuint32 + bytes calldata
    function bid(
        externalEuint32 inputEuint32,
        bytes calldata inputProof
    ) external beforeEnd {
        // 1) Chuyển external encrypted input -> euint32 on-chain
        euint32 cBid = FHE.fromExternal(inputEuint32, inputProof);

        // 2) (Khuyến nghị) Cấp quyền giải mã giống FHECounter
        FHE.allowThis(cBid);
        FHE.allow(cBid, msg.sender);

        // 3) Lưu bid
        encBids[msg.sender] = cBid;
        hasBid[msg.sender] = true;

        emit BidSubmitted(msg.sender);
    }

    /// @notice Chốt phiên: tìm bid lớn nhất & index winner (đều ở dạng encrypted)
    /// @param bidders Danh sách địa chỉ đã bid để xét (demo đơn giản)
    function settle(address[] calldata bidders) external onlySeller afterEnd {
        require(!settled, "already settled");
        require(bidders.length > 0, "no bidders");

        // 1) Tìm giá trị max (encrypted)
        euint32 best = FHE.asEuint32(0);
        for (uint256 i = 0; i < bidders.length; i++) {
            address b = bidders[i];
            if (!hasBid[b]) continue;

            euint32 c = encBids[b];
            ebool gt = FHE.gt(c, best);
            // chọn c nếu c > best, ngược lại giữ best (không lộ so sánh)
            best = FHE.select(gt, c, best);
        }

        // 2) Tìm index winner (encrypted) bằng equality
        euint32 bestIdxEnc = FHE.asEuint32(0);
        for (uint256 i = 0; i < bidders.length; i++) {
            address b = bidders[i];
            if (!hasBid[b]) continue;

            ebool eq = FHE.eq(encBids[b], best);
            bestIdxEnc = FHE.select(eq, FHE.asEuint32(uint32(i)), bestIdxEnc);
        }

        // 3) Lưu & cấp quyền giải mã (giống pattern FHECounter)
        winningBidEnc = best;
        winningIndexEnc = bestIdxEnc;

        FHE.allowThis(winningBidEnc);
        FHE.allow(winningBidEnc, seller);
        FHE.allowThis(winningIndexEnc);
        FHE.allow(winningIndexEnc, seller);

        settled = true;
        emit Settled();
    }

    /// @notice Trạng thái cơ bản (plaintext phần meta)
    function getStatus()
        external
        view
        returns (string memory _item, uint256 _end, bool _settled)
    {
        return (item, biddingEnd, settled);
    }
}
