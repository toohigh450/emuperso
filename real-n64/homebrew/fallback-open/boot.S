/* SPDX-License-Identifier: MIT
 * Emuperso experimental emulator-only boot, 8 MiB preallocated RDRAM.
 * No Nintendo bootcode, no RDRAM training, no RSP microcode.
 * This is NOT a physical-console boot validation.
 */
.set noreorder
.set noat
.section .text
.globl _boot
_boot:
    lui $t0, 0xa000
    lui $t1, 0xa080
1:  sw $zero, 0($t0)
    addiu $t0, $t0, 4
    bne $t0, $t1, 1b
    nop
    lui $t0, 0xb000
    ori $t0, $t0, 0x1000
    lui $t1, 0xa000
    ori $t1, $t1, 0x0400
    lui $t2, %hi(PROGRAM_BYTES)
    ori $t2, $t2, %lo(PROGRAM_BYTES)
    addu $t2, $t1, $t2
2:  lw $t3, 0($t0)
    sw $t3, 0($t1)
    addiu $t0, $t0, 4
    addiu $t1, $t1, 4
    bne $t1, $t2, 2b
    nop
    /* libdragon's open entrypoint reads these boot flags in SP DMEM. */
    lui $t0, 0xa400
    lui $t1, 0x0080
    sw $t1, 0($t0)
    sw $zero, 8($t0)
    addiu $t1, $zero, 1
    sb $t1, 9($t0)
    lui $sp, 0x8080
    addiu $sp, $sp, -16
    sync
    lui $t0, 0x8000
    ori $t0, $t0, 0x0400
    jr $t0
    nop
