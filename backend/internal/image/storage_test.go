package image

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStoreSavesCiphertextWithHash(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path, hash, err := store.SaveCiphertext("user-1", "photo-1", strings.NewReader("ciphertext"))
	if err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "ciphertext" || hash != "305531dcc50ebca31cf1d5b31e9fc76ed51f66b3b6dd5a030c6539ae6532f979" {
		t.Fatalf("unexpected ciphertext or hash")
	}
	if filepath.Ext(path) != ".bin" {
		t.Fatalf("path = %q", path)
	}
}

func TestStoreDeletesAllCiphertextForDeletedUser(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.SaveCiphertext("deleted-user", "photo", strings.NewReader("ciphertext")); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteUserCiphertext("deleted-user"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "deleted-user")); !os.IsNotExist(err) {
		t.Fatalf("ciphertext directory remains: %v", err)
	}
}
