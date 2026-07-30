# KJ-032 fixture: a -keep rule naming a class means reflection may reach it,
# so the class is alive. A wildcard keep does NOT name it and does not save it.
-keep class com.example.kj.g5deadweight.GhostKept { *; }
-keep class com.example.kj.g5deadweight.** { public *; }
