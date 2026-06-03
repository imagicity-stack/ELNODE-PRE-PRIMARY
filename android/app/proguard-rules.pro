# ── Capacitor runtime ──────────────────────────────────────────────────────
-keep class com.getcapacitor.** { *; }
-keep class com.elnode.erp.** { *; }
-dontwarn com.getcapacitor.**

# ── Capacitor / Cordova plugins ────────────────────────────────────────────
-keep class org.apache.cordova.** { *; }
-dontwarn org.apache.cordova.**

# ── WebView JavaScript bridge ──────────────────────────────────────────────
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ── Preserve crash-report line numbers ─────────────────────────────────────
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ── Enums (reflection-safe) ────────────────────────────────────────────────
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# ── Parcelable / Serializable ──────────────────────────────────────────────
-keepclassmembers class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator CREATOR;
}
-keepclassmembers class * implements java.io.Serializable {
    private static final long serialVersionUID;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}
