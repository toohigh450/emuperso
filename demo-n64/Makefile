BUILD_DIR=build
include $(N64_INST)/include/n64.mk

all: demo-emuperso.z64

OBJS = $(BUILD_DIR)/main.o

demo-emuperso.z64: N64_ROM_TITLE="DEMO N64 EMUPERSO"

$(BUILD_DIR)/demo-emuperso.elf: $(OBJS)

clean:
	rm -rf $(BUILD_DIR) *.z64

-include $(wildcard $(BUILD_DIR)/*.d)

.PHONY: all clean
