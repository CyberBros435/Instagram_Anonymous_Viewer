import os
import sys
import urllib
import urllib.parse
import re
import threading
import time
import uuid
from datetime import datetime
from urllib.parse import quote, unquote
import requests
import sqlite3
from flask import Flask, Response, jsonify, request, send_from_directory
import instaloader


def resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_path, relative_path)


HTML_DIR = resource_path("html")
CSS_DIR = resource_path("css")
JS_DIR = resource_path("js")
IMG_DIR = resource_path("img")

app = Flask(__name__)
app.secret_key = os.environ.get(
    "FLASK_SECRET", "super-secret-dev-key-change-this"
)

IG_BASE = "https://www.instagram.com"
DAILY_LIMIT = 30
REQUEST_DELAY = 1.5          # seconds to wait before every incoming request
X_IG_APP_ID = "936619743392459"

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/121.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "X-IG-App-ID": X_IG_APP_ID,
    "Referer": "https://www.instagram.com/",
}

DB_PATH = resource_path("limits.db")


def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS daily_limits (
            ip TEXT,
            date TEXT,
            count INTEGER,
            PRIMARY KEY (ip, date)
        )
    """)
    conn.commit()
    conn.close()


init_db()

L = instaloader.Instaloader(
    user_agent=(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/121.0.0.0 Safari/537.36"
    ),
    download_pictures=False,
    download_videos=False,
    download_video_thumbnails=False,
    download_geotags=False,
    download_comments=False,
    save_metadata=False,
    compress_json=False,
    request_timeout=10,
)

raw_session = "77831267898%3AhLqhg5nY3Vjiwb%3A18%3AAYha-JaSGrnJlJMIBVgs8RZAeVqPkVA5oPvQFXjsnA"
decoded_session = urllib.parse.unquote(raw_session)
L.context._session.cookies.set(
    "sessionid", decoded_session, domain=".instagram.com"
)
L.context._session.cookies.set(
    "ds_user_id", "77831267898", domain=".instagram.com"
)
L.context._session.cookies.set(
    "csrftoken", "uxY09fBZpYp77liPdVqV1JPbXiZLcrk4", domain=".instagram.com"
)
L.context._session.cookies.set(
    "mid", "aQXeLgALAAGffxmqrSrrtI2sZfmS", domain=".instagram.com"
)
L.context._session.cookies.set(
    "ig_did", "4D232B79-53EB-476C-A501-4C5AEFF4122E", domain=".instagram.com"
)
L.context._session.cookies.set(
    "datr", "Lt4FafxRUBCknPx9Fi3o9VU3", domain=".instagram.com"
)
L.context._username = "mudasir30098"
print("Session injected for mudasir30098")


@app.before_request
def global_request_delay():
    """Apply a small delay before every incoming request and log it."""
    now = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[{now}] ⏳  Incoming {request.method} {request.path}  "
          f"— waiting {REQUEST_DELAY}s before processing ...")
    time.sleep(REQUEST_DELAY)
    done = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[{done}] ✅  Delay done — now handling {request.method} {request.path}")

LAST_IG_REQUEST = 0
LAST_IG_LOCK = threading.Lock()


def ig_throttle():
    """Throttle outgoing Instagram requests to at least 2 s apart."""
    global LAST_IG_REQUEST
    with LAST_IG_LOCK:
        now = time.time()
        elapsed = now - LAST_IG_REQUEST
        wait = 2.0 - elapsed
        ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        if wait > 0:
            print(f"[{ts}] 🔒  IG throttle — last request {elapsed:.2f}s ago, "
                  f"sleeping {wait:.2f}s before next IG call ...")
            time.sleep(wait)
            done_ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
            print(f"[{done_ts}] 🚀  IG throttle done — sending request to Instagram")
        else:
            print(f"[{ts}] 🚀  IG throttle — last request {elapsed:.2f}s ago, "
                  f"no wait needed — sending request to Instagram")
        LAST_IG_REQUEST = time.time()


POST_ITERATORS = {}
REEL_ITERATORS = {}
ITERATOR_LOCK = threading.Lock()
ITERATOR_TTL = 600


def save_iterator(it, prefix="post"):
    uid = f"{prefix}_{uuid.uuid4().hex}"
    with ITERATOR_LOCK:
        if prefix == "post":
            POST_ITERATORS[uid] = {"it": it, "ts": time.time()}
        else:
            REEL_ITERATORS[uid] = {"it": it, "ts": time.time()}
    return uid


def get_iterator(uid):
    with ITERATOR_LOCK:
        if "post" in uid:
            data = POST_ITERATORS.get(uid)
        else:
            data = REEL_ITERATORS.get(uid)
    if data:
        data["ts"] = time.time()
        return data["it"]
    return None


PROFILE_CACHE = {}
PROFILE_CACHE_TTL = 120


def get_cached_profile(username):
    item = PROFILE_CACHE.get(username)
    if item and time.time() - item["ts"] < PROFILE_CACHE_TTL:
        print(f"Cache hit for {username}")
        return item["profile"]
    ig_throttle()
    profile = instaloader.Profile.from_username(L.context, username)
    PROFILE_CACHE[username] = {"profile": profile, "ts": time.time()}
    return profile


def clean_username(raw: str) -> str:
    if not raw:
        return ""
    raw = raw.strip()
    path = re.sub(r"^https?://(www\.)?instagram\.com/", "", raw)
    path = path.split("/")[0]
    path = path.replace("@", "")
    return re.sub(r"[^a-zA-Z0-9._]", "", path)


def format_date(dt):
    if not dt:
        return "—"
    return dt.strftime("%Y-%m-%d")


def transform_post(p):
    return {
        "id": p.mediaid,
        "shortcode": p.shortcode,
        "thumbnail": p.url,
        "display_url": p.url,
        "video_url": p.video_url,
        "is_video": p.is_video,
        "permalink": f"https://www.instagram.com/p/{p.shortcode}/",
        "like_count": p.likes,
        "comment_count": p.comments,
        "view_count": p.video_view_count if p.is_video else None,
        "taken_at": int(p.date_utc.timestamp()),
        "caption": p.caption,
    }


def get_client_ip():
    if request.headers.get("X-Forwarded-For"):
        return request.headers.get("X-Forwarded-For").split(",")[0].strip()
    return request.remote_addr


def check_and_update_limits():
    ip = get_client_ip()
    today = datetime.now().strftime("%Y-%m-%d")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT count FROM daily_limits WHERE ip = ? AND date = ?",
            (ip, today)
        )
        row = cursor.fetchone()
        if row:
            current_count = row[0]
            if current_count >= DAILY_LIMIT:
                return (
                    False,
                    f"Daily limit reached ({DAILY_LIMIT}/{DAILY_LIMIT}). "
                    f"Come back tomorrow!",
                )
            new_count = current_count + 1
            cursor.execute(
                "UPDATE daily_limits SET count = ? WHERE ip = ? AND date = ?",
                (new_count, ip, today),
            )
        else:
            cursor.execute(
                "INSERT INTO daily_limits (ip, date, count) VALUES (?, ?, ?)",
                (ip, today, 1),
            )
        conn.commit()
        return True, "OK"
    except Exception as e:
        print(f"Database error: {e}")
        return True, "Error checking limits"
    finally:
        conn.close()


def get_current_usage():
    ip = get_client_ip()
    today = datetime.now().strftime("%Y-%m-%d")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT count FROM daily_limits WHERE ip = ? AND date = ?",
        (ip, today)
    )
    row = cursor.fetchone()
    conn.close()
    return row[0] if row else 0


@app.get("/api/limits")
def api_limits():
    used = get_current_usage()
    return jsonify({"status": True, "data": {"used": used, "total": DAILY_LIMIT}})


@app.get("/api/reset-limits")
def reset_limits():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM daily_limits")
    conn.commit()
    conn.close()
    return jsonify({"status": True, "message": "Limits reset"})


@app.get("/favicon.ico")
def favicon():
    return "", 204


@app.get("/api/profile")
def api_profile():
    allowed, msg = check_and_update_limits()
    if not allowed:
        return jsonify({
            "status": False,
            "message": msg,
            "code": "LIMIT_REACHED"
        }), 403

    raw = request.args.get("u", "")
    username = clean_username(raw)
    if not username:
        return jsonify({"status": False, "message": "Invalid username."}), 400

    try:
        profile = get_cached_profile(username)

        data = {
            "id": profile.userid,
            "username": profile.username,
            "full_name": profile.full_name,
            "biography": profile.biography,
            "external_url": profile.external_url,
            "profile_pic_url": profile.profile_pic_url,
            "is_private": profile.is_private,
            "is_verified": profile.is_verified,
            "followers": profile.followers,
            "following": profile.followees,
            "posts_count": profile.mediacount,
            "profile_url": f"https://www.instagram.com/{username}/",
        }

        posts_items = []
        reels_items = []
        next_cursor_posts = None
        next_cursor_reels = None
        analytics = {
            "engagement_estimate": "—",
            "posting_frequency": "—",
            "last_post_date": "—",
        }

        if not profile.is_private:
            try:
                posts_it = profile.get_posts()
                count = 0
                for p in posts_it:
                    posts_items.append(transform_post(p))
                    count += 1
                    if count >= 12:
                        break

                if count == 12:
                    next_cursor_posts = save_iterator(posts_it, "post")

                reels_temp_it = profile.get_posts()
                scanned = 0
                found_reels = 0
                for p in reels_temp_it:
                    scanned += 1
                    if p.is_video:
                        reels_items.append(transform_post(p))
                        found_reels += 1
                    if found_reels >= 12:
                        break
                    if scanned >= 150:
                        break

                if found_reels >= 12 or scanned >= 150:
                    next_cursor_reels = save_iterator(reels_temp_it, "reel")

                if posts_items:
                    total_eng = sum(
                        p["like_count"] + p["comment_count"]
                        for p in posts_items
                    )
                    if profile.followers > 0:
                        eng = (
                            (total_eng / len(posts_items))
                            / profile.followers * 100
                        )
                        analytics["engagement_estimate"] = f"{eng:.2f}%"
                    ts = [p["taken_at"] for p in posts_items]
                    if len(ts) >= 2:
                        span = (max(ts) - min(ts)) / 86400
                        if span > 0:
                            per_week = (len(ts) / span) * 7
                            analytics["posting_frequency"] = (
                                f"{per_week:.1f}/week"
                            )
                    analytics["last_post_date"] = format_date(
                        datetime.fromtimestamp(max(ts))
                    )
            except Exception as e:
                print(f"Posts fetch error: {e}")

        resp = {
            "username": data["username"],
            "full_name": data["full_name"],
            "biography": data["biography"],
            "profile_pic_url": data["profile_pic_url"],
            "is_private": data["is_private"],
            "followers": data["followers"],
            "following": data["following"],
            "posts_count": data["posts_count"],
            "profile_url": data["profile_url"],
            "external_url": data["external_url"],
            "analytics": analytics,
            "posts": {
                "items": posts_items,
                "next_cursor": next_cursor_posts,
                "has_next": (next_cursor_posts is not None),
            },
            "reels": {
                "items": reels_items,
                "next_cursor": next_cursor_reels,
                "has_next": (next_cursor_reels is not None),
            },
        }

        return jsonify({"status": True, "data": resp})

    except instaloader.ConnectionException:
        return jsonify({
            "status": False,
            "message": "Instagram blocked this request. Try again later.",
            "code": "COOLDOWN"
        }), 429
    except instaloader.LoginRequiredException:
        return jsonify({
            "status": False,
            "message": "Login required for this profile."
        }), 403
    except Exception as e:
        print(f"Error fetching profile: {e}")
        return jsonify({"status": False, "message": str(e)}), 500


@app.get("/")
def home():
    return send_from_directory(HTML_DIR, "dashboard.html")


@app.get("/css/<path:filename>")
def css_files(filename):
    return send_from_directory(CSS_DIR, filename)


@app.get("/js/<path:filename>")
def js_files(filename):
    return send_from_directory(JS_DIR, filename)


@app.get("/img/<path:filename>")
def img_files(filename):
    return send_from_directory(IMG_DIR, filename)


@app.get("/api/posts")
def api_posts():
    username = request.args.get("u")
    cursor = request.args.get("cursor")

    if not cursor:
        if not username:
            return jsonify({
                "status": False,
                "message": "No cursor or username provided."
            })
        try:
            profile = get_cached_profile(username)
            it = profile.get_posts()
            cursor = save_iterator(it, "post")
        except Exception as e:
            return jsonify({"status": False, "message": str(e)})

    it = get_iterator(cursor)
    if not it:
        return jsonify({
            "status": True,
            "data": {"items": [], "next_cursor": None, "has_next": False}
        })

    items = []
    try:
        count = 0
        for p in it:
            items.append(transform_post(p))
            count += 1
            if count >= 6:
                break
        has_next = count >= 6
        return jsonify({
            "status": True,
            "data": {
                "items": items,
                "next_cursor": cursor if has_next else None,
                "has_next": has_next
            }
        })
    except StopIteration:
        return jsonify({
            "status": True,
            "data": {"items": [], "next_cursor": None, "has_next": False}
        })
    except Exception as e:
        return jsonify({"status": False, "message": str(e)})


@app.get("/api/reels")
def api_reels():
    username = request.args.get("u")
    cursor = request.args.get("cursor")

    if not cursor:
        if not username:
            return jsonify({
                "status": False,
                "message": "No cursor or username provided."
            })
        try:
            profile = get_cached_profile(username)
            it = profile.get_posts()
            cursor = save_iterator(it, "reel")
        except Exception as e:
            return jsonify({"status": False, "message": str(e)})

    it = get_iterator(cursor)
    if not it:
        return jsonify({
            "status": True,
            "data": {"items": [], "next_cursor": None, "has_next": False}
        })

    items = []
    try:
        found = 0
        scanned = 0
        for p in it:
            scanned += 1
            if p.is_video:
                items.append(transform_post(p))
                found += 1
            if found >= 6:
                break
            if scanned >= 100:
                break
        has_next = found >= 6
        return jsonify({
            "status": True,
            "data": {
                "items": items,
                "next_cursor": cursor if has_next else None,
                "has_next": has_next
            }
        })
    except Exception as e:
        return jsonify({"status": False, "message": str(e)})


@app.get("/api/media")
def api_media_proxy():
    src = request.args.get("src", "").strip()
    if not src:
        return "", 400
    try:
        r = requests.get(src, headers=DEFAULT_HEADERS)
        if r.status_code != 200:
            return "", 404
        ct = r.headers.get("Content-Type", "image/jpeg")
        return Response(r.content, content_type=ct)
    except:
        return "", 404


@app.get("/api/download/media")
def api_download_media():
    src = request.args.get("src", "").strip()
    name = request.args.get("name", "download")
    if not src:
        return "", 400
    try:
        r = requests.get(src, headers=DEFAULT_HEADERS)
        if r.status_code != 200:
            return "", 404
        ct = r.headers.get("Content-Type", "image/jpeg")
        ext = "mp4" if "mp4" in ct else "jpg"
        return Response(
            r.content,
            content_type=ct,
            headers={
                "Content-Disposition": f'attachment; filename="{name}.{ext}"'
            }
        )
    except:
        return "", 404


@app.get("/api/download/profile-pic")
def api_download_pfp():
    u = request.args.get("u")
    try:
        profile = get_cached_profile(u)
        pic_url = profile.profile_pic_url
        r = requests.get(pic_url, headers=DEFAULT_HEADERS)
        if r.status_code != 200:
            return jsonify({
                "status": False,
                "message": "Failed to fetch image"
            }), 500
        ct = r.headers.get("Content-Type", "image/jpeg")
        return Response(
            r.content,
            content_type=ct,
            headers={
                "Content-Disposition": f'attachment; filename="{u}_profile.jpg"'
            }
        )
    except Exception as e:
        return jsonify({"status": False, "message": str(e)}), 500


@app.get("/api/profile-pic")
def api_profile_pic_proxy():
    u = request.args.get("u")
    if not u:
        return "", 404
    try:
        p = get_cached_profile(u)
        pic_url = p.profile_pic_url
        r = requests.get(pic_url, headers=DEFAULT_HEADERS)
        if r.status_code == 200:
            return Response(
                r.content,
                content_type=r.headers.get("Content-Type", "image/jpeg")
            )
        return "", 404
    except Exception as e:
        print(f"PFP Proxy error: {e}")
        return "", 404


@app.get("/api/analytics")
def api_analytics():
    username = request.args.get("u")
    if not username:
        return jsonify({"status": False, "message": "Username required"}), 400
    try:
        profile = get_cached_profile(username)
        posts_data = {"labels": [], "values": []}
        reels_data = {"labels": [], "values": []}
        posts_it = profile.get_posts()
        count = 0
        for post in posts_it:
            count += 1
            if count > 10:
                break
            date_label = post.date_utc.strftime("%m/%d")
            engagement = post.likes + post.comments
            if post.is_video:
                reels_data["labels"].append(date_label)
                reels_data["values"].append(
                    post.video_view_count
                    if post.video_view_count
                    else engagement
                )
            else:
                posts_data["labels"].append(date_label)
                posts_data["values"].append(engagement)
        posts_data["labels"].reverse()
        posts_data["values"].reverse()
        reels_data["labels"].reverse()
        reels_data["values"].reverse()
        return jsonify({
            "status": True,
            "data": {"posts": posts_data, "reels": reels_data}
        })
    except Exception as e:
        print(f"Analytics error: {e}")
        return jsonify({
            "status": True,
            "data": {
                "posts": {"labels": [], "values": []},
                "reels": {"labels": [], "values": []}
            }
        })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=False)
