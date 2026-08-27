package notification

import (
	"strings"
	"testing"
)

func TestValidInputAcceptsSupportedNotificationContract(t *testing.T) {
	for _, kind := range []Type{
		TypeNewApplication,
		TypeMatchConfirmed,
		TypeApplicationRejected,
		TypeNewMessage,
		TypeApplicationWithdrawn,
		TypeGuideCanceled,
		TypeGuideUpdated,
		TypeGuideReminder,
		TypeRecruitmentExpired,
	} {
		if !validInput(CreateInput{
			UserID:      "user-1",
			EventKey:    "event-1",
			Type:        kind,
			TargetID:    "target-1",
			Destination: DestinationChat,
		}) {
			t.Fatalf("valid input rejected for type %q", kind)
		}
	}
}

func TestValidInputRejectsMissingOrUnknownFields(t *testing.T) {
	base := CreateInput{
		UserID:      "user-1",
		EventKey:    "event-1",
		Type:        TypeNewMessage,
		TargetID:    "target-1",
		Destination: DestinationChat,
	}
	for name, input := range map[string]CreateInput{
		"missing user":        {EventKey: base.EventKey, Type: base.Type, TargetID: base.TargetID, Destination: base.Destination},
		"missing event":       {UserID: base.UserID, Type: base.Type, TargetID: base.TargetID, Destination: base.Destination},
		"missing target":      {UserID: base.UserID, EventKey: base.EventKey, Type: base.Type, Destination: base.Destination},
		"unknown type":        {UserID: base.UserID, EventKey: base.EventKey, Type: Type("unknown"), TargetID: base.TargetID, Destination: base.Destination},
		"unknown destination": {UserID: base.UserID, EventKey: base.EventKey, Type: base.Type, TargetID: base.TargetID, Destination: Destination("unknown")},
	} {
		t.Run(name, func(t *testing.T) {
			if validInput(input) {
				t.Fatal("invalid input was accepted")
			}
		})
	}
}

func TestRandomIDIsOpaqueURLSafeValue(t *testing.T) {
	value, err := randomID()
	if err != nil {
		t.Fatal(err)
	}
	if len(value) != 22 || strings.ContainsAny(value, "+/=") {
		t.Fatalf("random notification ID is not raw base64url: %q", value)
	}
}
