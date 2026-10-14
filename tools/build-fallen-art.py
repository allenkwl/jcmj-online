#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""亡國動畫的美術：用伺服器上的 ComfyUI（經 com.allen.comfy-tunnel 轉到 127.0.0.1:8188）。

    python3 tools/build-fallen-art.py still qin          秦：畫「戰敗的主公」（FLUX.2 參考圖改圖），預設 3 張不同種子
    python3 tools/build-fallen-art.py still qin --seeds 5
    python3 tools/build-fallen-art.py video qin --last 選好的那張.png
                                                         秦：出征的最後一格 → 戰敗，頭尾兩張生影片（LTX-2.5）

2026-10-14 使用者：「亡國要專屬動畫」「這次改用 Comfy 來畫」
「LTX 若效果不好就用幾個動作圖片來製作，先看效果」。

── 為什麼從「出征三格」的最後一格開始 ──
原本的主公立繪是頭肩特寫，跪下來的戰敗姿勢要全身 —— 頭尾構圖差太多，影片會變成怪異的拉鏡頭。
出征的最後一格本來就是全身，而且遊戲裡輪到自己時主公最後就停在這一格：
亡國動畫從這裡接下去「倒下」，前後是連得起來的。

── 卡片對應 ──
still 照伺服器上的「31.改圖-同主體換場景-dev」（FLUX.2 dev＋ReferenceLatent，加速 LoRA 旁路、20 步）
video 照「45.影片-頭尾兩張圖生影片-LTX2.5」

輸出在 assets/portraits/fallen/（跟原圖放一起，不進 git）；挑好、壓好的才放 assets/fallen/。
"""
import argparse, json, os, sys, time, urllib.parse, urllib.request, uuid

HOST = 'http://127.0.0.1:8188'
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'assets', 'portraits')
OUT = os.path.join(SRC, 'fallen')

# 各國主公頭上戴的東西（照當初畫主公的描述 assets/portraits/prompts/*_lord.txt）。
# ⚠️ 不能只寫 crown：FLUX.2 一看到 crown／king 就畫成歐式金王冠（秦的冕旒兩輪都被換掉，實測）。
#    改成把形狀講清楚、而且明說「跟參考圖一樣」。
HEADWEAR = {
    'qi':   'his tall blue hat with gold ornaments',
    'chu':  'his very tall green "cloud-cutting" high hat with gold ornaments',
    'yan':  'his purple headdress with gold ornaments',
    'han':  'his orange headdress with gold ornaments',
    'wei':  'his red headdress with gold ornaments over his grey topknot',
    'zhao': 'his fur hat with a sable tail and a small gold ornament on the front',
    'qin':  'his black mianliu headdress: a flat black board on top with strings of round gold beads hanging from its edges',
}

# 各國出征圖拿的東西不一樣（齊劍＋鶴、楚鳳凰大旗、燕劍、韓指揮弩箭、魏戰鼓、趙騎馬射箭）。
# 提示詞寫死「劍斷了」的話，FLUX 會硬塞一把劍給沒拿劍的人 —— 照各國的道具寫。
PROPS = {
    'qi':   {'mid': 'his sword snaps in two in his hand and his white crane flies off in alarm',
             'still': 'his sword lies broken in two on the ground and his white crane droops sadly beside him',
             'video': 'his sword snaps and his white crane flees'},
    'chu':  {'mid': 'the pole of his green phoenix banner snaps in his hands and the banner tears',
             'still': 'his green phoenix banner lies torn on the ground with its pole snapped in two',
             'video': 'the pole of his phoenix banner snaps and the banner falls'},
    'yan':  {'mid': 'his sword snaps in two in his hand with the broken blade flying off',
             'still': 'his sword lies broken in two on the ground beside him',
             'video': 'his sword snaps in two'},
    'han':  {'mid': 'his crossbow snaps in his hands and the arrows scatter',
             'still': 'his broken crossbow and scattered arrows lie on the ground around him',
             'video': 'his crossbow snaps and the arrows scatter'},
    'wei':  {'mid': 'his drumsticks break and the red war drum beside him splits open',
             'still': 'his red war drum lies split open beside him with the broken drumsticks dropped on the ground',
             'video': 'his drumsticks break and his war drum splits open'},
    'zhao': {'mid': 'he is thrown from his rearing horse as his bow snaps in two',
             'still': 'his bow lies snapped in two on the ground and his horse stands behind him with its head hanging low',
             'video': 'his bow snaps and he is thrown from his horse'},
    'qin':  {'mid': 'his sword snaps in two in his hand with the broken blade flying off',
             'still': 'his sword lies broken in two on the ground beside him',
             'video': 'his sword snaps in two'},
}

def still_prompt(k, mid=False):
    if mid:
        # 中間格：頭尾兩張生影片時倒下只花 1 秒、中間踉蹌那一下是糊的 —— 多一張中間圖把過程撐開
        return (
            'Edit the reference image. Keep the character EXACTLY the same: same face, same hair, '
            + HEADWEAR[k] + ' (unchanged, exactly as in the reference), same robe colors and patterns, '
            'same super-deformed chibi art style with very thick black outlines and flat cel shading. Full body. '
            'Change ONLY his pose and mood — the battle is lost: he staggers backwards, still on his feet but his knees buckle, '
            + PROPS[k]['mid'] + ', '
            'the golden energy around him fades into grey smoke, his face shows shock and pain, '
            'his robe is starting to tear. Muted colors. '
            'Plain flat very dark brown background with nothing else. No text, no letters, no border.'
        )
    return (
        'Edit the reference image. Keep the character EXACTLY the same: same face, same hair, '
        + HEADWEAR[k] + ' (unchanged, exactly as in the reference), same robe colors and patterns, '
        'same super-deformed chibi art style with very thick black outlines and flat cel shading. '
        'Change ONLY his pose and mood — his kingdom has fallen: he kneels on one knee on cracked scorched ground, '
        'head bowed low in grief, eyes shut, one tear on his cheek; his headdress is knocked slightly askew; '
        + PROPS[k]['still'] + '; his robe is torn and dusted with grey ash. '
        'Grey ash and a few glowing embers drift in the air. Muted, desaturated, sorrowful colors. '
        'Plain flat very dark brown background with nothing else. No text, no letters, no border.'
    )


def api(path, data=None, raw=False):
    req = urllib.request.Request(HOST + path) if data is None else urllib.request.Request(
        HOST + path, data=json.dumps(data).encode(), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            b = r.read()
    except urllib.error.HTTPError as e:
        # ⚠️ /prompt 驗證失敗的原因全在 body 裡（同 lords.py）
        raise SystemExit(f'{path} 回 {e.code}：\n{e.read().decode("utf-8", "replace")[:2000]}')
    return b if raw else json.loads(b)


def upload_image(path, name):
    boundary = '----mj' + uuid.uuid4().hex
    blob = open(path, 'rb').read()
    body = b''
    for k, v in [('overwrite', 'true'), ('type', 'input')]:
        body += f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    body += (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\n'
             f'Content-Type: image/png\r\n\r\n').encode() + blob + b'\r\n' + f'--{boundary}--\r\n'.encode()
    req = urllib.request.Request(HOST + '/upload/image', data=body,
                                 headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    with urllib.request.urlopen(req, timeout=300) as r:
        up = json.loads(r.read())
    return up['name'] if not up.get('subfolder') else f"{up['subfolder']}/{up['name']}"


OI = {}
def defaults(cls):
    """節點必填欄位的預設值（同 lords.py：從 /object_info 帶出來，只覆寫要改的）"""
    if cls not in OI:
        OI[cls] = api('/object_info/' + urllib.parse.quote(cls))[cls]
    out = {}
    for k, spec in OI[cls].get('input', {}).get('required', {}).items():
        t, meta = spec[0], (spec[1] if len(spec) > 1 else {})
        if isinstance(t, list): out[k] = t[0] if t else ''
        elif t == 'COMBO': out[k] = (meta.get('options') or [''])[0]
        elif 'default' in meta: out[k] = meta['default']
        else: out[k] = None
    return out


def node(g, nid, cls, **over):
    d = defaults(cls); d.update(over)
    g[nid] = {'class_type': cls, 'inputs': d}
    return nid


def wait(pid, label, timeout=3600):
    t0 = time.time()
    while time.time() - t0 < timeout:
        h = api(f'/history/{pid}')
        if pid in h:
            st = h[pid].get('status', {})
            err = [m for m in st.get('messages', []) if m and m[0] == 'execution_error']
            if err:
                e = err[0][1]
                return None, f"{e.get('node_type')}: {str(e.get('exception_message'))[:300]}"
            return h[pid], None
        print(f'  {label} … {int(time.time() - t0)}s', end='\r', flush=True)
        time.sleep(3)
    return None, '逾時'


def fetch(hist, prefix):
    os.makedirs(OUT, exist_ok=True)
    got = []
    for out in hist.get('outputs', {}).values():
        for key in ('images', 'gifs', 'videos'):
            for f in out.get(key, []) or []:
                qs = urllib.parse.urlencode({'filename': f['filename'], 'subfolder': f.get('subfolder', ''),
                                             'type': f.get('type', 'output')})
                dst = os.path.join(OUT, prefix + '_' + f['filename'].split('/')[-1])
                open(dst, 'wb').write(api('/view?' + qs, raw=True))
                got.append(dst)
    return got


def war_frame(k):
    """出征三格的最後一格（全身、高解析度）：從 *_lord_anim.png 這張三格橫圖切第三格，壓到深色底上。"""
    from PIL import Image
    sheet = Image.open(os.path.join(SRC, f'{k}_lord_anim.png')).convert('RGBA')
    w = sheet.width // 3
    fr = sheet.crop((w * 2, 0, w * 3, sheet.height))
    side = max(fr.size)
    bg = Image.new('RGBA', (side, side), (26, 18, 12, 255))      # 跟提示詞的「很深的褐色底」一致
    bg.alpha_composite(fr, ((side - fr.width) // 2, (side - fr.height) // 2))
    os.makedirs(OUT, exist_ok=True)
    dst = os.path.join(OUT, f'_{k}_war3.png')
    bg.convert('RGB').resize((1024, 1024)).save(dst)
    return dst


SEED0 = 1000
def still(k, seeds, mid=False):
    src = war_frame(k)
    img = upload_image(src, f'mjfallen_{k}_war3.png')
    for i in range(seeds):
        seed = SEED0 + i * 7919
        g = {}
        node(g, '1', 'LoadImage', image=img)
        node(g, '2', 'ImageScaleToTotalPixels', image=['1', 0], upscale_method='lanczos', megapixels=1.0)
        node(g, '3', 'GetImageSize', image=['2', 0])
        node(g, '4', 'UNETLoader', unet_name='flux2_dev_fp8mixed.safetensors', weight_dtype='default')
        node(g, '5', 'CLIPLoader', clip_name='mistral_3_small_flux2_fp8.safetensors', type='flux2')
        node(g, '6', 'VAELoader', vae_name='full_encoder_small_decoder.safetensors')
        node(g, '7', 'CLIPTextEncode', clip=['5', 0], text=still_prompt(k, mid))
        node(g, '9', 'VAEEncode', pixels=['2', 0], vae=['6', 0])
        g['10'] = {'class_type': 'ReferenceLatent', 'inputs': {'conditioning': ['7', 0], 'latent': ['9', 0]}}
        node(g, '21', 'FluxGuidance', conditioning=['10', 0], guidance=4.0)
        node(g, '12', 'BasicGuider', model=['4', 0], conditioning=['21', 0])
        node(g, '13', 'KSamplerSelect', sampler_name='euler')
        node(g, '14', 'Flux2Scheduler', steps=20, width=['3', 0], height=['3', 1])
        node(g, '15', 'RandomNoise', noise_seed=seed)
        node(g, '16', 'EmptyFlux2LatentImage', width=['3', 0], height=['3', 1], batch_size=1)
        node(g, '17', 'SamplerCustomAdvanced', noise=['15', 0], guider=['12', 0], sampler=['13', 0],
             sigmas=['14', 0], latent_image=['16', 0])
        node(g, '18', 'VAEDecode', samples=['17', 0], vae=['6', 0])
        node(g, '19', 'SaveImage', images=['18', 0], filename_prefix=f'mjfallen/{k}_{"mid" if mid else "still"}_s{seed}')
        r = api('/prompt', {'prompt': g, 'client_id': 'mjfallen'})
        hist, err = wait(r['prompt_id'], f'{k} 戰敗圖 {i + 1}/{seeds}')
        if err:
            print(f'\n  失敗：{err}'); continue
        print('\n  → ' + ', '.join(os.path.relpath(p, ROOT) for p in fetch(hist, k)))


VIDEO_PROMPT = (
    'A chibi cartoon king in a flat cel-shaded illustration style with very thick black outlines, '
    'on a plain dark brown background. He starts in a fierce battle pose, swinging his sword with golden energy. '
    'Slowly the golden energy fades away, his sword cracks and breaks and falls to the ground, his shoulders drop, '
    'and he sinks down to kneel on one knee, bowing his head in grief as a tear runs down his cheek. '
    'Grey ash and a few embers drift down and the colors slowly drain to a muted grey. '
    'Static camera. The character design, headwear and robe stay exactly the same throughout.'
)
VIDEO_NEG = ('blurry, out of focus, flickering, distorted proportions, extra limbs, morphing face, '
             'realistic, photo, 3d render, text, watermark, camera shake')


VIDEO_PROMPT_MID = (
    'A chibi cartoon king in a flat cel-shaded illustration style with very thick black outlines, '
    'on a plain dark brown background. He starts in a fierce battle pose, charging into battle with golden energy around him. '
    'The golden energy flickers and fades into grey smoke; he staggers backwards in shock and pain as {prop}. '
    'Then, slowly and heavily, his knees give way and he sinks down to kneel '
    'on one knee, his head bowing lower and lower in grief until a tear runs down his cheek. '
    'Grey ash and a few embers drift down and the colors slowly drain to a muted grey. '
    'Static camera. The character design, headwear and robe stay exactly the same throughout.'
)


def video(k, last, mid=None, size=768, frames=97, fps=24, seed=4242):
    """mid 給了就是三張圖：第 0 格出征、mid_at 格踉蹌劍斷、最後一格跪地。總長拉到 5 秒，倒下不會一秒就結束。"""
    if mid:
        frames = 121
    mid_at = 48
    first = os.path.join(OUT, f'_{k}_war3.png')
    if not os.path.exists(first):
        war_frame(k)
    f_img = upload_image(first, f'mjfallen_{k}_first.png')
    l_img = upload_image(last, f'mjfallen_{k}_last.png')
    g = {}
    node(g, '1', 'UNETLoader', unet_name='ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors', weight_dtype='default')
    node(g, '2', 'CLIPLoader', clip_name='gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors', type='ltxv')
    node(g, '3', 'VAELoader', vae_name='ltx-2.5-video-vae-bf16.safetensors')
    node(g, '4', 'CLIPTextEncode', clip=['2', 0],
         text=VIDEO_PROMPT_MID.format(prop=PROPS[k]['video']) if mid else VIDEO_PROMPT)
    node(g, '5', 'CLIPTextEncode', clip=['2', 0], text=VIDEO_NEG)
    node(g, '6', 'LTXVConditioning', positive=['4', 0], negative=['5', 0], frame_rate=float(fps))
    node(g, '7', 'LoadImage', image=f_img)
    node(g, '8', 'LoadImage', image=l_img)
    node(g, '9', 'ImageScale', image=['7', 0], upscale_method='lanczos', width=size, height=size, crop='center')
    node(g, '10', 'ImageScale', image=['8', 0], upscale_method='lanczos', width=size, height=size, crop='center')
    node(g, '11', 'LTXVPreprocess', image=['9', 0], img_compression=18)
    node(g, '12', 'LTXVPreprocess', image=['10', 0], img_compression=18)
    node(g, '13', 'EmptyLTXVLatentVideo', width=size, height=size, length=frames, batch_size=1)
    node(g, '14', 'LTXVAddGuide', positive=['6', 0], negative=['6', 1], vae=['3', 0], latent=['13', 0],
         image=['11', 0], frame_idx=0, strength=1.0)
    prev = '14'
    if mid:
        m_img = upload_image(mid, f'mjfallen_{k}_mid.png')
        node(g, '30', 'LoadImage', image=m_img)
        node(g, '31', 'ImageScale', image=['30', 0], upscale_method='lanczos', width=size, height=size, crop='center')
        node(g, '32', 'LTXVPreprocess', image=['31', 0], img_compression=18)
        node(g, '33', 'LTXVAddGuide', positive=['14', 0], negative=['14', 1], vae=['3', 0], latent=['14', 2],
             image=['32', 0], frame_idx=mid_at, strength=0.8)
        prev = '33'
    node(g, '15', 'LTXVAddGuide', positive=[prev, 0], negative=[prev, 1], vae=['3', 0], latent=[prev, 2],
         image=['12', 0], frame_idx=-1, strength=0.9)
    node(g, '16', 'CFGGuider', model=['1', 0], positive=['15', 0], negative=['15', 1], cfg=1.0)
    node(g, '17', 'SamplerEulerAncestral', eta=0.0, s_noise=1.0)
    node(g, '18', 'ManualSigmas', sigmas='1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0')
    node(g, '19', 'RandomNoise', noise_seed=seed)
    node(g, '20', 'SamplerCustomAdvanced', noise=['19', 0], guider=['16', 0], sampler=['17', 0],
         sigmas=['18', 0], latent_image=['15', 2])
    node(g, '21', 'LTXVCropGuides', positive=['15', 0], negative=['15', 1], latent=['20', 0])
    node(g, '22', 'VAEDecodeTiled', samples=['21', 2], vae=['3', 0], tile_size=512, overlap=64,
         temporal_size=64, temporal_overlap=16)
    node(g, '23', 'SaveWEBM', images=['22', 0], filename_prefix=f'mjfallen/{k}_fall{"3" if mid else ""}_s{seed}', fps=float(fps), crf=20.0)
    r = api('/prompt', {'prompt': g, 'client_id': 'mjfallen'})
    hist, err = wait(r['prompt_id'], f'{k} 亡國影片')
    if err:
        sys.exit(f'\n  失敗：{err}')
    print('\n  → ' + ', '.join(os.path.relpath(p, ROOT) for p in fetch(hist, f'{k}_fall')))


def pack(k, vid, still_png, size=512):
    """挑好的影片與跪地圖 → assets/fallen/<國>.mp4、<國>.webp（遊戲用的那一份）。
    mp4 用 H.264：Safari／iPhone 都放得出來（WebM 在舊 iPhone 不保險）。512px 在畫面上夠用，每國約 0.3 MB。"""
    import subprocess
    from PIL import Image
    dst = os.path.join(ROOT, 'assets', 'fallen')
    os.makedirs(dst, exist_ok=True)
    mp4 = os.path.join(dst, f'{k}.mp4')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', vid, '-vf', f'scale={size}:{size}:flags=lanczos',
                    '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-an',
                    '-movflags', '+faststart', mp4], check=True)
    Image.open(still_png).convert('RGB').resize((size, size), Image.LANCZOS).save(
        os.path.join(dst, f'{k}.webp'), 'WEBP', quality=84, method=6)
    for f in (mp4, os.path.join(dst, f'{k}.webp')):
        print(f'  {os.path.relpath(f, ROOT)}  {os.path.getsize(f) // 1024} KB')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('step', choices=['still', 'mid', 'video', 'pack'])
    ap.add_argument('--video')
    ap.add_argument('kingdom')
    ap.add_argument('--seeds', type=int, default=3)
    ap.add_argument('--last')
    ap.add_argument('--mid')
    ap.add_argument('--seed0', type=int, default=1000)
    a = ap.parse_args()
    if a.step in ('still', 'mid'):
        global SEED0
        SEED0 = a.seed0
        still(a.kingdom, a.seeds, mid=(a.step == 'mid'))
    elif a.step == 'pack':
        pack(a.kingdom, a.video, a.last)
    else:
        if not a.last:
            sys.exit('要給 --last（戰敗圖）')
        video(a.kingdom, a.last, a.mid)


if __name__ == '__main__':
    main()
