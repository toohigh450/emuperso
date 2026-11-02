/* SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Karl (toohigh450)
 * Freestanding diagnostic port of Claude's demo behavior, by Codex.
 * Real VR4300 instructions, VI framebuffer, SI controller and AI audio MMIO.
 * Emulator-only 8 MiB bootstrap. No libdragon runtime, RSP or commercial boot.
 */
#include <stdint.h>
#define MMIO(base) ((volatile uint32_t *)(base))
#define VI MMIO(0xA4400000u)
#define SI MMIO(0xA4800000u)
#define AI MMIO(0xA4500000u)
#define FB_PHYS 0x00100000u
#define FB_ALT_PHYS 0x00140000u
static volatile uint16_t *fb = (volatile uint16_t *)0xA0100000u;
#define FB fb
#define JOY ((volatile uint8_t *)0xA0200000u)
#define JOY_PHYS 0x00200000u
#define PCM ((volatile int16_t *)0xA0300000u)
#define PCM_PHYS 0x00300000u
#define WIDTH 320
#define HEIGHT 240
/* NTSC VI timing values from libdragon src/vi.h, Unlicense; notice included. */
static const uint32_t ntsc[14]={0,0,0,2,0,0x03e52239,0x20d,0x0c15,0x0c150c15,0x006c02ec,0x002501ff,0x000e0204,0x200,0x400};
static uint32_t count(void){uint32_t x;__asm__ volatile("mfc0 %0,$9":"=r"(x));return x;}
static uint16_t color(unsigned r,unsigned g,unsigned b){return (uint16_t)(((r&31)<<11)|((g&31)<<6)|((b&31)<<1)|1);}
/* Original elementary 5x7 patterns, A-Z then 0-9. */
static const uint8_t glyphs[36][7]={
{14,17,17,31,17,17,17},{30,17,17,30,17,17,30},{14,17,16,16,16,17,14},
{30,17,17,17,17,17,30},{31,16,16,30,16,16,31},{31,16,16,30,16,16,16},
{14,17,16,23,17,17,15},{17,17,17,31,17,17,17},{31,4,4,4,4,4,31},
{7,2,2,2,18,18,12},{17,18,20,24,20,18,17},{16,16,16,16,16,16,31},
{17,27,21,21,17,17,17},{17,25,21,19,17,17,17},{14,17,17,17,17,17,14},
{30,17,17,30,16,16,16},{14,17,17,17,21,18,13},{30,17,17,30,20,18,17},
{15,16,16,14,1,1,30},{31,4,4,4,4,4,4},{17,17,17,17,17,17,14},
{17,17,17,17,17,10,4},{17,17,17,21,21,21,10},{17,17,10,4,10,17,17},
{17,17,10,4,4,4,4},{31,1,2,4,8,16,31},
{14,17,19,21,25,17,14},{4,12,4,4,4,4,14},{14,17,1,2,4,8,31},
{30,1,1,14,1,1,30},{2,6,10,18,31,2,2},{31,16,16,30,1,1,30},
{14,16,16,30,17,17,14},{31,1,2,4,8,8,8},{14,17,17,14,17,17,14},
{14,17,17,15,1,1,14}};
static void text(int x,int y,const char*s){for(;*s;s++,x+=12){int n=*s>='A'&&*s<='Z'?*s-'A':*s>='0'&&*s<='9'?26+*s-'0':-1;if(n<0)continue;for(int j=0;j<7;j++)for(int i=0;i<5;i++)if(glyphs[n][j]&(16>>i)){int p=(y+j*2)*WIDTH+x+i*2;FB[p]=FB[p+1]=FB[p+WIDTH]=FB[p+WIDTH+1]=0xffff;}}}
static void decimal(int x,int y,uint32_t value){char s[11];int n=0;do{s[n++]=(char)('0'+value%10);value/=10;}while(value&&n<10);for(int i=0;i<n/2;i++){char c=s[i];s[i]=s[n-1-i];s[n-1-i]=c;}s[n]=0;text(x,y,s);}
static int si_wait(void){for(unsigned i=0;i<50000;i++)if(!(SI[6]&3)){SI[6]=0;return 1;}return 0;}
static uint16_t buttons(void){
 if(!si_wait())return 0;
 for(int i=0;i<64;i++)JOY[i]=0xff;
 JOY[0]=1;JOY[1]=4;JOY[2]=1;JOY[3]=JOY[4]=JOY[5]=JOY[6]=0;JOY[7]=0xfe;JOY[63]=1;
 SI[0]=JOY_PHYS;SI[4]=0x1fc007c0u;if(!si_wait())return 0;
 SI[0]=JOY_PHYS;SI[1]=0x1fc007c0u;if(!si_wait())return 0;
 if(JOY[1]&0xc0)return 0;return (uint16_t)((JOY[3]<<8)|JOY[4]);
}
static uint32_t phase=0;
static void audio(unsigned beep){
 /* AI has a two-entry FIFO; fill once when a slot is available. */
 if(AI[3]&0x80000000u)return;
 for(unsigned i=0;i<736;i++){int16_t v=0;if(beep){phase+=440;if(phase>=44100)phase-=44100;v=phase<22050?4500:-4500;}PCM[i*2]=v;PCM[i*2+1]=v;}
 AI[0]=PCM_PHYS;AI[1]=736*4;
}
void main(void){
 for(int i=0;i<WIDTH*HEIGHT;i++){((volatile uint16_t *)0xA0100000u)[i]=color(2,5,10);((volatile uint16_t *)0xA0140000u)[i]=color(2,5,10);}
 for(int i=1;i<14;i++)VI[i]=ntsc[i];
 VI[1]=FB_PHYS;VI[2]=WIDTH;VI[0]=0x00003202u;
 AI[2]=1;AI[4]=1103;AI[5]=15; /* NTSC 48.681812 MHz / 1104, approx 44.096 kHz */
 uint32_t frame=0;int box=20,dx=2;unsigned back=1;
 for(;;){
  fb=(volatile uint16_t *)(back?0xA0140000u:0xA0100000u);
  uint32_t start=count();uint16_t keys=buttons();unsigned a=(keys>>15)&1,b=(keys>>14)&1;
  uint16_t bg=color(((frame>>1)&7)+(a?16:0),((frame>>2)&7)+(b?16:0),8+((frame>>3)&7));
  for(int i=0;i<WIDTH*HEIGHT;i++)FB[i]=bg;
  text(18,20,"DEMO N64 EMUPERSO");text(18,50,"FRAME");decimal(100,50,frame);
  text(18,85,a?"A PRESSE SON":"A RELACHE");text(18,110,b?"B PRESSE":"B RELACHE");
  text(18,145,"CPU VI SI AI REELS");
  box+=dx;if(box<10||box>290)dx=-dx;
  for(int y=190;y<210;y++)for(int x=box;x<box+20;x++)FB[y*WIDTH+x]=0xffff;
  /* Never draw into the displayed surface. Flip only after this frame is complete.
   * Wait for vertical blank where available; bounded by CPU Count so a missing
   * VI scanline update cannot lock the diagnostic ROM. */
  while((VI[4]&0x3ffu)<0x200u && (uint32_t)(count()-start)<1562500u)audio(a);
  __asm__ volatile("sync" ::: "memory");
  VI[1]=back?FB_ALT_PHYS:FB_PHYS;
  back^=1;
  frame++;audio(a);
  while((uint32_t)(count()-start)<781250u)audio(a);
 }
}
