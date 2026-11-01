# Speaks one line with Microsoft's neural voices (edge-tts) and records when each word starts and ends,
# so build.mjs can cue the camera and captions to the narration.
# usage: python tts.py <voice> <rate> <text> <out.mp3> <out.json>
import asyncio
import json
import sys

import edge_tts


async def main(voice, rate, text, media, words_file):
    words = []
    with open(media, 'wb') as out:
        async for chunk in edge_tts.Communicate(text, voice, rate=rate, boundary='WordBoundary').stream():
            if chunk['type'] == 'audio':
                out.write(chunk['data'])
            elif chunk['type'] == 'WordBoundary':
                start = chunk['offset'] / 1e7
                words.append({'word': chunk['text'], 'start': round(start, 3), 'end': round(start + chunk['duration'] / 1e7, 3)})
    with open(words_file, 'w', encoding='utf-8') as out:
        json.dump(words, out)


asyncio.run(main(*sys.argv[1:6]))
