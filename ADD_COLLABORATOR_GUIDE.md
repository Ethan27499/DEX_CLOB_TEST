# Hướng dẫn thêm Collaborator vào Repository DEX_CLOB_TEST

## Thông tin Collaborator
- **GitHub Username**: Nampp1805
- **Permission Level**: Admin (Full quyền)
- **Repository**: https://github.com/Ethan27499/DEX_CLOB_TEST

## Cách thêm qua GitHub Web Interface:

### Bước 1: Truy cập Repository Settings
1. Mở https://github.com/Ethan27499/DEX_CLOB_TEST
2. Click tab **"Settings"** (ở phía trên, bên phải)
3. Trong sidebar bên trái, click **"Collaborators and teams"**

### Bước 2: Thêm Collaborator
1. Click nút **"Add people"** (màu xanh)
2. Trong ô "Search by username, full name or email address", nhập: `Nampp1805`
3. Chọn user `Nampp1805` từ kết quả search
4. Chọn permission level: **"Admin"** để cấp full quyền
5. Click **"Add Nampp1805 to this repository"**

### Bước 3: Xác nhận
- GitHub sẽ gửi invitation email cho Nampp1805
- Người được mời cần accept invitation để có quyền truy cập
- Sau khi accept, họ sẽ có full quyền với repository

## Các quyền Admin bao gồm:
- ✅ Read (clone, fetch, download)
- ✅ Write (push, create branches, create tags)
- ✅ Triage (manage issues, pull requests)
- ✅ Maintain (manage repository settings, webhooks)
- ✅ Admin (full control including adding/removing collaborators)

## Alternative: Sử dụng GitHub CLI (nếu có quyền)
```bash
# Nếu có GitHub CLI với đủ permissions:
gh api -X PUT /repos/Ethan27499/DEX_CLOB_TEST/collaborators/Nampp1805 -f permission=admin
```

## Verification
Sau khi thêm thành công, bạn có thể verify bằng cách:
1. Quay lại trang "Collaborators and teams"
2. Kiểm tra `Nampp1805` xuất hiện trong danh sách collaborators
3. Đảm bảo permission level hiển thị là "Admin"
