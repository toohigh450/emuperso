/*
 * Démo N64 homebrew minimale — opération N64 Web (emuperso)
 * Basée sur libdragon (SDK N64 open-source).
 *
 * Ce que fait la démo :
 *   1. Affiche du texte et un carré qui bouge + un fond qui change de couleur
 *      (preuve que « ça vit » : compteur d'images affiché à l'écran).
 *   2. Lit la manette du port 1 et affiche l'état des boutons A et B.
 *   3. Joue une tonalité (La 440 Hz) tant que A est maintenu.
 *
 * ÉTAT : écrit sans pouvoir compiler ni tester (pas de chaîne MIPS ni de
 * réseau dans l'environnement de rédaction). À compiler et vérifier.
 */
#include <libdragon.h>
#include <stdint.h>
#include <stdio.h>

#define SAMPLE_RATE 44100
#define TONE_HZ     440
#define AMPLITUDE   6000   /* volume modeste, pour ne pas surprendre */

/* Génère un buffer audio stéréo : onde carrée à TONE_HZ si 'beep', sinon silence. */
static void audio_pump(bool beep)
{
    static uint32_t phase = 0;                 /* compteur d'échantillons */
    const uint32_t half_period = SAMPLE_RATE / (TONE_HZ * 2);

    while (audio_can_write()) {
        short *buf = audio_write_begin();
        int frames = audio_get_buffer_length(); /* nombre d'échantillons stéréo */
        for (int i = 0; i < frames; i++) {
            short s = 0;
            if (beep) {
                s = ((phase / half_period) & 1) ? AMPLITUDE : -AMPLITUDE;
                phase++;
            }
            buf[i * 2]     = s;                 /* gauche */
            buf[i * 2 + 1] = s;                 /* droite */
        }
        audio_write_end();
    }
}

int main(void)
{
    display_init(RESOLUTION_320x240, DEPTH_16_BPP, 2, GAMMA_NONE, FILTERS_RESAMPLE);
    joypad_init();
    audio_init(SAMPLE_RATE, 4);

    uint32_t frame = 0;
    int box_x = 20, box_dx = 2;
    char line[64];

    while (1) {
        /* --- Entrées --- */
        joypad_poll();
        joypad_buttons_t held = joypad_get_buttons_held(JOYPAD_PORT_1);

        /* --- Dessin --- */
        surface_t *disp = display_get();

        /* Fond : change doucement de couleur ; plus clair si A ou B est pressé. */
        uint8_t r = (frame >> 1) & 0x3F;
        uint8_t g = (frame >> 2) & 0x3F;
        uint8_t b = 0x40 + ((frame >> 3) & 0x3F);
        if (held.a) r += 0x80;
        if (held.b) g += 0x80;
        graphics_fill_screen(disp, graphics_make_color(r, g, b, 255));

        /* Carré qui rebondit : preuve visuelle que la boucle tourne. */
        box_x += box_dx;
        if (box_x < 10 || box_x > 290) box_dx = -box_dx;
        graphics_draw_box(disp, box_x, 190, 20, 20, graphics_make_color(255, 255, 255, 255));

        /* Textes */
        graphics_set_color(graphics_make_color(255, 255, 255, 255), 0);
        graphics_draw_text(disp, 20, 20, "DEMO N64 - EMUPERSO");
        snprintf(line, sizeof(line), "Image : %lu", (unsigned long)frame);
        graphics_draw_text(disp, 20, 50, line);
        snprintf(line, sizeof(line), "A : %s", held.a ? "PRESSE (son)" : "relache");
        graphics_draw_text(disp, 20, 80, line);
        snprintf(line, sizeof(line), "B : %s", held.b ? "PRESSE" : "relache");
        graphics_draw_text(disp, 20, 100, line);
        graphics_draw_text(disp, 20, 140, "Maintenir A = tonalite 440 Hz");

        display_show(disp);

        /* --- Audio : tonalité tant que A est maintenu --- */
        audio_pump(held.a);

        frame++;
    }
    return 0;
}
