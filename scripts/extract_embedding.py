#!/usr/bin/env python3
import sys
import json
import numpy as np
import os
import warnings
import logging
import tempfile

# Отключаем все возможные предупреждения и логи
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
warnings.filterwarnings("ignore")
logging.getLogger("tensorflow").setLevel(logging.ERROR)
logging.getLogger("numpy").setLevel(logging.ERROR)

# Перенаправляем stderr в /dev/null
sys.stderr = open(os.devnull, 'w')

# Создаем временный файл для перенаправления stdout
temp_stdout = tempfile.NamedTemporaryFile(mode='w+', delete=False)
original_stdout = sys.stdout
sys.stdout = temp_stdout

# Импортируем resemblyzer после настройки логирования
from resemblyzer import VoiceEncoder

def extract_embedding(audio_path):
    try:
        # Загрузка raw PCM файла (16-bit, mono, 16000 Hz)
        with open(audio_path, "rb") as f:
            raw_audio = np.frombuffer(f.read(), dtype=np.int16)

        # Преобразуем int16 в float32
        float_audio = raw_audio.astype(np.float32) / 32768.0

        # Проверка на моно
        if float_audio.ndim != 1:
            raise ValueError("Expected mono channel audio")

        # Инициализация энкодера и получение эмбеддинга
        encoder = VoiceEncoder()
        embedding = encoder.embed_utterance(float_audio)

        # Если вернулся кортеж — берём первый элемент
        if isinstance(embedding, tuple):
            embedding = embedding[0]

        # Восстанавливаем stdout и выводим только JSON
        sys.stdout = original_stdout
        print(json.dumps(embedding.tolist()))
        
        # Закрываем и удаляем временный файл
        temp_stdout.close()
        os.unlink(temp_stdout.name)

    except Exception as e:
        # Восстанавливаем stdout и выводим ошибку в stderr
        sys.stdout = original_stdout
        print(f"Error extracting embedding: {str(e)}", file=sys.stderr)
        
        # Закрываем и удаляем временный файл
        temp_stdout.close()
        os.unlink(temp_stdout.name)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python extract_embedding.py <audio_file>", file=sys.stderr)
        sys.exit(1)

    audio_path = sys.argv[1]
    extract_embedding(audio_path)
