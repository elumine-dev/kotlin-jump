package com.example.app

object R {
    object string {
        val app_name             = 0
        val app_version          = 1
        val title_pokedex        = 2
        val title_team           = 3
        val title_battle         = 4
        val title_users          = 5
        val label_pokemon_name   = 6
        val label_pokemon_level  = 7
        val label_pokemon_type   = 8
        val label_pokemon_hp     = 9
        val label_user_name      = 10
        val label_user_email     = 11
        val label_user_role      = 12
        val role_admin           = 13
        val role_editor          = 14
        val role_viewer          = 15
        val action_add_pokemon   = 16
        val action_start_battle  = 17
        val action_catch_pokemon = 18
        val action_release_pokemon = 19
        val action_cancel        = 20
        val action_confirm       = 21
        val action_retry         = 22
        val msg_loading          = 23
        val msg_empty_team       = 24
        val msg_battle_won       = 25
        val msg_battle_lost      = 26
        val msg_battle_draw      = 27
        val msg_pokemon_caught   = 28
        val msg_invalid_name     = 29
        val msg_team_full        = 30
        val error_network        = 31
        val error_not_found      = 32
        val error_unknown        = 33
        val type_fire            = 34
        val type_water           = 35
        val type_grass           = 36
        val type_electric        = 37
        val type_psychic         = 38
        val type_dragon          = 39
        val disclaimer_long      = 40
        val msg_missing_in_en    = 41
        val title_missing_in_en  = 42
        // Sprint 1 Feature 4 — format string preview
        val msg_welcome_user     = 43
        val msg_level_up         = 44
        val msg_damage           = 45
        val msg_score            = 46
        val msg_team_slots       = 47
        val msg_move_pp          = 48
        val msg_hp_bar           = 49
        val msg_catch_rate       = 50
        val msg_reward           = 51
        val msg_exp_needed       = 52
        // Sprint 1 Feature 6 — translation completeness
        val sprint1_welcome      = 53
        val sprint1_start        = 54
        val sprint1_fr_only      = 55
        val sprint1_default_only = 56
        // Edge case — defined in R.kt but missing from XML → no decoration
        val this_key_does_not_exist = -1
        val key_does_not_exist   = -1
        // Sprint 2 Feature 4 — defined in R.kt, missing from XML (diagnostic demo)
        val sprint2_catch_dialog     = -1
        val sprint2_evolution_prompt = -1
        val sprint2_sync_status      = -1
        val sprint2_team_saved_msg   = -1
    }

    object color {
        val primary              = 100
        val primary_dark         = 101
        val primary_light        = 102
        val secondary            = 103
        val secondary_dark       = 104
        val background           = 105
        val surface              = 106
        val surface_variant      = 107
        val on_primary           = 108
        val on_surface           = 109
        val text_primary         = 110
        val text_secondary       = 111
        val text_hint            = 112
        val error                = 113
        val success              = 114
        val warning              = 115
        val info                 = 116
        val translucent_black    = 117
        val translucent_primary  = 118
        val scrim                = 119
        val accent_short         = 120
        val white_short          = 121
        val black_short          = 122
        val semi_transparent_white = 123
        val type_fire            = 124
        val type_water           = 125
        val type_grass           = 126
        val type_electric        = 127
        val type_psychic         = 128
        val type_dragon          = 129
        val this_color_does_not_exist = -1
        // Sprint 2 Feature 4 — defined in R.kt, missing from XML (diagnostic demo)
        val sprint2_gradient_overlay = -1
        val sprint2_primary_gradient = -1
        val sprint2_ripple_overlay   = -1
        val sprint2_divider_line     = -1
        val sprint2_shimmer_base     = -1
    }

    object dimen {
        val spacing_xs           = 200
        val spacing_sm           = 201
        val spacing_md           = 202
        val spacing_lg           = 203
        val spacing_xl           = 204
        val spacing_xxl          = 205
        val text_size_caption    = 206
        val text_size_body       = 207
        val text_size_body_large = 208
        val text_size_title      = 209
        val text_size_headline   = 210
        val text_size_display    = 211
        val card_corner_radius   = 212
        val card_elevation       = 213
        val button_height        = 214
        val button_corner_radius = 215
        val input_height         = 216
        val divider_height       = 217
        val toolbar_height       = 218
        val icon_size_sm         = 219
        val icon_size_md         = 220
        val icon_size_lg         = 221
        val icon_size_xl         = 222
        val pokemon_card_width   = 223
        val pokemon_card_height  = 224
        val pokemon_avatar_size  = 225
        val this_dimen_does_not_exist = -1
    }

    object drawable {
        val ic_pokeball          = 300
        val ic_type_fire         = 301
        val this_drawable_does_not_exist = -1
    }

    object plurals {
        val pokemon_count        = 400
        val battle_wins          = 401
        val item_count           = 402
        val this_plural_does_not_exist = -1
    }

    object array {
        val pokemon_types        = 500
        val user_roles           = 501
        val difficulty_levels    = 502
        val this_array_does_not_exist = -1
    }
}
