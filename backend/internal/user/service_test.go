package user

import (
	"errors"
	"strings"
	"testing"
)

func TestNormalizeProfileInputAcceptsJapaneseBio(t *testing.T) {
	name, country, bio, err := normalizeProfileInput("  太郎  ", "jp", "  写真と旅が好きです\nよろしくお願いします  ")
	if err != nil {
		t.Fatalf("normalizeProfileInput() error = %v", err)
	}
	if name != "太郎" || country != "JP" || bio != "写真と旅が好きです\nよろしくお願いします" {
		t.Fatalf("normalized profile = %q/%q/%q", name, country, bio)
	}
}

func TestNormalizeProfileInputRejectsInvalidValues(t *testing.T) {
	tests := []struct {
		name      string
		inputName string
		country   string
		bio       string
		want      error
	}{
		{name: "empty name", inputName: "", country: "JP", bio: "valid", want: ErrInvalidProfile},
		{name: "invalid country", inputName: "太郎", country: "JPN", bio: "valid", want: ErrInvalidProfile},
		{name: "non ascii country", inputName: "太郎", country: "ß", bio: "valid", want: ErrInvalidProfile},
		{name: "control in name", inputName: "太\n郎", country: "JP", bio: "valid", want: ErrInvalidProfile},
		{name: "long bio", inputName: "太郎", country: "JP", bio: strings.Repeat("あ", maxProfileBioRunes+1), want: ErrInvalidProfile},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, _, _, err := normalizeProfileInput(test.inputName, test.country, test.bio)
			if !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestProfileNameLimitMatchesPasskeyDisplayNameLimit(t *testing.T) {
	if maxProfileNameRunes != 64 {
		t.Fatalf("max profile name runes = %d, want 64", maxProfileNameRunes)
	}
	if _, _, _, err := normalizeProfileInput(strings.Repeat("あ", maxProfileNameRunes+1), "JP", ""); !errors.Is(err, ErrInvalidProfile) {
		t.Fatalf("overlong profile name error = %v, want ErrInvalidProfile", err)
	}
}
