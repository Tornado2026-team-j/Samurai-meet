package meeting

import (
	"errors"
	"testing"
)

func TestValidateProximityAcceptsOnlyBoundedClientEstimates(t *testing.T) {
	valid := ProximityInput{Method: "bluetooth_rssi", DistanceBand: "nearby"}
	if err := validateProximity(valid); err != nil {
		t.Fatalf("valid proximity rejected: %v", err)
	}
	for _, test := range []struct {
		name  string
		input ProximityInput
	}{
		{name: "unknown method", input: ProximityInput{Method: "raw_ble", DistanceBand: "nearby"}},
		{name: "exact distance is not a supported field", input: ProximityInput{Method: "bluetooth_rssi", DistanceBand: ""}},
		{name: "unknown distance band", input: ProximityInput{Method: "location_inference", DistanceBand: "meters"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := validateProximity(test.input); !errors.Is(err, ErrMeetingInvalidInput) {
				t.Fatalf("error = %v, want ErrMeetingInvalidInput", err)
			}
		})
	}
}
