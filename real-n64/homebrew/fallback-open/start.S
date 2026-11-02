/* SPDX-License-Identifier: MIT */
.set noreorder
.set noat
.section .text.start
.globl _start
_start:
 lui $sp,0x8080
 addiu $sp,$sp,-16
 mtc0 $zero,$12
 nop
 nop
 jal main
 nop
1: b 1b
 nop
