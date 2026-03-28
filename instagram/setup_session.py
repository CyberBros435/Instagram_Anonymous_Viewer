import instaloader

L = instaloader.Instaloader()

try:
    L.login("mudasir30098", "instagram30098@!`}{'/,._-+=,k@li")
    L.save_session_to_file()
    print("✅ Session saved successfully for mudasir30098")
except Exception as e:
    print(f"❌ Login failed: {e}")
