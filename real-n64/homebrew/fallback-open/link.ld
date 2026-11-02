OUTPUT_ARCH(mips)
ENTRY(_start)
SECTIONS {
 . = 0x80000400;
 .text : { KEEP(*(.text.start)) *(.text .text.*) }
 .rodata : { *(.rodata .rodata.*) }
 .data : { *(.data .data.*) }
 .bss : { *(.bss .bss.* COMMON) }
 /DISCARD/ : { *(.MIPS.abiflags) *(.reginfo) *(.comment) *(.note*) }
}
