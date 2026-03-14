---
title: 'AI 비서에게 얼굴을 만들어줬다 — CSS 애니메이션으로 캐릭터 구현하기'
date: 2026-03-14 00:00:00
description: '순수 CSS와 바닐라 JavaScript만으로 AI 비서 캐릭터에게 생동감 넘치는 얼굴을 만들어준 경험을 공유합니다. 마우스를 따라가는 눈동자, 시간대별 표정 변화, 클릭 인터랙션까지 — 서버 없이도 가능한 인터랙티브 캐릭터 디자인 튜토리얼입니다.'
featured_image: '/images/2026-03-14-AI-Assistant-Face-CSS-Animation/cover.jpg'
---

![AI 비서 캐릭터](/images/2026-03-14-AI-Assistant-Face-CSS-Animation/cover.jpg)

## 텍스트보다 얼굴이 있으면 좋겠다

AI 비서를 쓰다 보니 문득 이런 생각이 들었습니다. **"이 친구에게 얼굴이 있으면 어떨까?"** 채팅창의 텍스트만 보는 것보다, 눈을 깜빡이고 표정을 짓는 캐릭터가 있다면 훨씬 친근하게 느껴질 것 같았죠.

그래서 순수 **CSS + JavaScript**만으로 AI 비서 "브래드(Brad)"에게 얼굴을 만들어줬습니다. 서버도, 복잡한 라이브러리도 필요 없이 브라우저 하나면 충분합니다. 이 글에서는 어떻게 구현했는지, 어떤 기술을 사용했는지 상세히 소개합니다.

## 완성된 기능들

### 1. 마우스를 따라가는 눈동자

마우스 커서가 움직이면 눈동자가 그 방향을 따라봅니다. 실시간으로 좌표를 계산해서 눈동자 위치를 업데이트합니다.

### 2. 시간대별 표정 변화

- **낮 (9시~18시)**: 밝고 활기찬 표정 (눈이 크고, 입이 웃는 모양)
- **저녁 (18시~21시)**: 평온한 표정
- **밤 (21시~0시)**: 졸린 표정 (눈이 가늘어지고, 입이 작아짐)
- **새벽 (0시~7시)**: 완전히 졸린 모드

### 3. 클릭 인터랙션

얼굴을 클릭하면:
- 한쪽 눈으로 윙크
- 말풍선이 나타나며 메시지 표시 (예: "안녕! 👋", "뭐해? 🤔")
- 볼에 홍조가 나타남

### 4. 랜덤 행동

8초마다 무작위 행동:
- 윙크
- 혼잣말 (말풍선)
- 시선 이동 (두리번)
- 안테나 깜빡임
- 이퀄라이저 애니메이션 (말하는 듯한 효과)

### 5. 실시간 시계

현재 시각을 실시간으로 표시 (`HH:MM:SS` 형식)

![애니메이션 효과](/images/2026-03-14-AI-Assistant-Face-CSS-Animation/animation.jpg)

## 기술 스택

- **HTML5**: 구조
- **CSS3**: 애니메이션, 그라디언트, 그림자 효과
- **JavaScript (Vanilla)**: 인터랙션, 이벤트 처리, 시간 계산
- **서버 불필요**: 정적 HTML 파일 하나면 끝

## 구현 과정

### 1. 얼굴 구조 설계 (HTML + CSS)

얼굴은 원형 `div`에 눈, 입, 안테나, 볼터치 요소를 배치했습니다.

```html
<div class="face">
  <!-- 안테나 -->
  <div class="antenna">
    <div class="antenna-ball"></div>
  </div>
  
  <!-- 볼터치 -->
  <div class="cheek left"></div>
  <div class="cheek right"></div>
  
  <!-- 눈 -->
  <div class="eyes">
    <div class="eye left">
      <div class="pupil"></div>
    </div>
    <div class="eye right">
      <div class="pupil"></div>
    </div>
  </div>
  
  <!-- 입 -->
  <div class="mouth">
    <div class="mouth-shape"></div>
  </div>
</div>
```

### CSS로 얼굴 스타일링

```css
.face {
  position: relative;
  width: 240px;
  height: 240px;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  border-radius: 50%;
  border: 3px solid rgba(0,180,255,0.4);
  box-shadow: 0 0 40px rgba(0,180,255,0.2);
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  transition: border-color 1s ease, box-shadow 1s ease;
}
```

**포인트:**
- `linear-gradient`로 깊이감 있는 배경
- `box-shadow`로 네온 글로우 효과
- `transition`으로 상태 변화 시 부드러운 전환

### 눈 디자인

```css
.eye {
  width: 40px;
  height: 40px;
  background: #00b4ff;
  border-radius: 50%;
  position: relative;
  box-shadow: 0 0 20px rgba(0,180,255,0.6);
  animation: blink 4s ease-in-out infinite;
  transition: background 0.5s, height 0.5s;
  overflow: hidden;
}

.pupil {
  position: absolute;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  transition: transform 0.15s ease-out;
}

@keyframes blink {
  0%, 42%, 58%, 100% { transform: scaleY(1); }
  45%, 55% { transform: scaleY(0.08); }
}
```

**포인트:**
- `animation: blink`으로 자동 깜빡임 (4초 주기)
- `pupil`은 절대 위치 기준으로 JavaScript에서 `transform` 조작

![코드 구조](/images/2026-03-14-AI-Assistant-Face-CSS-Animation/code.jpg)

### 2. 마우스 추적 (JavaScript)

마우스 좌표를 실시간으로 받아서 눈동자가 그 방향을 바라보게 만듭니다.

```javascript
document.addEventListener('mousemove', (e) => {
  const faceRect = face.getBoundingClientRect();
  const faceCX = faceRect.left + faceRect.width / 2;
  const faceCY = faceRect.top + faceRect.height / 2;
  
  const dx = e.clientX - faceCX;
  const dy = e.clientY - faceCY;
  const dist = Math.sqrt(dx*dx + dy*dy);
  const maxMove = 8; // 최대 이동 거리 (px)
  
  const moveX = (dx / Math.max(dist, 1)) * Math.min(dist / 20, maxMove);
  const moveY = (dy / Math.max(dist, 1)) * Math.min(dist / 20, maxMove);
  
  pupilL.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
  pupilR.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
});
```

**핵심 로직:**
1. 얼굴 중심 좌표 계산
2. 마우스와의 거리/각도 계산
3. 거리 비례로 눈동자 이동량 결정 (단, 최대 8px로 제한)
4. `transform: translate()`로 동적 위치 변경

### 3. 시간대별 표정 변화

현재 시각에 따라 표정을 자동으로 바꿉니다.

```javascript
function getMood() {
  const hour = new Date().getHours();
  if (hour >= 0 && hour < 7) return 'sleepy';
  if (hour >= 7 && hour < 9) return 'waking';
  if (hour >= 9 && hour < 18) return 'happy';
  if (hour >= 18 && hour < 21) return 'happy';
  if (hour >= 21 && hour < 23) return 'sleepy';
  return 'sleepy';
}

function applyMood() {
  const mood = getMood();
  face.className = 'face ' + mood;
  eyeL.className = 'eye left ' + mood;
  eyeR.className = 'eye right ' + mood;
  mouth.className = 'mouth-shape ' + mood;
}

// 1분마다 무드 체크
setInterval(applyMood, 60000);
```

**CSS 상태별 스타일:**

```css
/* 행복한 표정 */
.eye.happy {
  background: #00ff96;
  box-shadow: 0 0 20px rgba(0,255,150,0.6);
}
.mouth-shape.happy {
  width: 60px;
  height: 30px;
  border-color: #00ff96;
  border-radius: 0 0 30px 30px;
}

/* 졸린 표정 */
.eye.sleepy {
  height: 15px;
  margin-top: 12px;
  background: #6450c8;
  box-shadow: 0 0 15px rgba(100,80,200,0.5);
}
.mouth-shape.sleepy {
  width: 20px;
  height: 12px;
  border: 3px solid #6450c8;
  border-radius: 50%;
}
```

### 4. 클릭 인터랙션 & 말풍선

얼굴을 클릭하면 윙크하고 메시지를 보여줍니다.

```javascript
const clickReactions = [
  { text: '안녕! 👋', duration: 2000 },
  { text: '뭐해? 🤔', duration: 2000 },
  { text: 'ㅋㅋㅋ', duration: 1500 },
  { text: '간지러워 😆', duration: 2000 },
  { text: '일하는 중...', duration: 2000 },
  { text: '커피 ☕', duration: 1500 },
];

document.addEventListener('click', (e) => {
  const faceRect = face.getBoundingClientRect();
  if (e.clientX > faceRect.left && e.clientX < faceRect.right &&
      e.clientY > faceRect.top && e.clientY < faceRect.bottom) {
    
    const reaction = clickReactions[clickCount % clickReactions.length];
    showSpeech(reaction.text, reaction.duration);
    clickCount++;
    
    // 윙크
    eyeR.classList.add('wink');
    cheekL.classList.add('visible');
    cheekR.classList.add('visible');
    setTimeout(() => {
      eyeR.classList.remove('wink');
      cheekL.classList.remove('visible');
      cheekR.classList.remove('visible');
    }, 800);
  }
});

function showSpeech(text, duration = 2000) {
  speech.textContent = text;
  speech.classList.add('show');
  setTimeout(() => speech.classList.remove('show'), duration);
}
```

**말풍선 CSS:**

```css
.speech-bubble {
  position: absolute;
  top: -60px;
  background: rgba(0,180,255,0.15);
  border: 1px solid rgba(0,180,255,0.3);
  border-radius: 12px;
  padding: 8px 16px;
  color: #00b4ff;
  font-size: 14px;
  opacity: 0;
  transform: translateY(10px);
  transition: all 0.3s ease;
}

.speech-bubble.show {
  opacity: 1;
  transform: translateY(0);
}

.speech-bubble::after {
  content: '';
  position: absolute;
  bottom: -8px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-top: 8px solid rgba(0,180,255,0.3);
}
```

![인터랙션](/images/2026-03-14-AI-Assistant-Face-CSS-Animation/interaction.jpg)

### 5. 랜덤 행동 시스템

8초마다 무작위로 행동을 선택해서 실행합니다.

```javascript
function randomAction() {
  const actions = ['wink', 'talk', 'look', 'antenna', 'eq'];
  const action = actions[Math.floor(Math.random() * actions.length)];
  
  switch(action) {
    case 'wink':
      eyeL.classList.add('wink');
      setTimeout(() => eyeL.classList.remove('wink'), 500);
      break;
    
    case 'talk':
      mouth.classList.add('talking');
      eq.classList.add('active');
      const phrases = ['...', '음...', '처리 중', '확인!', '🤖'];
      showSpeech(phrases[Math.floor(Math.random() * phrases.length)], 1500);
      setTimeout(() => {
        mouth.classList.remove('talking');
        eq.classList.remove('active');
      }, 1500);
      break;
    
    case 'look':
      // 눈동자를 랜덤한 방향으로 이동
      const rx = (Math.random() - 0.5) * 16;
      const ry = (Math.random() - 0.5) * 16;
      pupilL.style.transform = `translate(calc(-50% + ${rx}px), calc(-50% + ${ry}px))`;
      pupilR.style.transform = `translate(calc(-50% + ${rx}px), calc(-50% + ${ry}px))`;
      setTimeout(() => {
        pupilL.style.transform = 'translate(-50%, -50%)';
        pupilR.style.transform = 'translate(-50%, -50%)';
      }, 1500);
      break;
    
    case 'antenna':
      antenna.classList.add('alert');
      setTimeout(() => antenna.classList.remove('alert'), 2000);
      break;
    
    case 'eq':
      eq.classList.add('active');
      mouth.classList.add('talking');
      setTimeout(() => {
        eq.classList.remove('active');
        mouth.classList.remove('talking');
      }, 2000);
      break;
  }
}

setInterval(randomAction, 8000);
```

### 6. 이퀄라이저 애니메이션

말할 때 이퀄라이저가 움직이는 효과를 줍니다.

```css
.equalizer {
  position: absolute;
  bottom: -45px;
  display: flex;
  gap: 3px;
  opacity: 0;
  transition: opacity 0.3s;
}

.equalizer.active { opacity: 0.5; }

.eq-bar {
  width: 3px;
  background: #00b4ff;
  border-radius: 2px;
  animation: eq 0.8s ease-in-out infinite alternate;
}

.eq-bar:nth-child(1) { height: 8px; animation-delay: 0s; }
.eq-bar:nth-child(2) { height: 14px; animation-delay: 0.1s; }
.eq-bar:nth-child(3) { height: 10px; animation-delay: 0.2s; }
.eq-bar:nth-child(4) { height: 18px; animation-delay: 0.15s; }
.eq-bar:nth-child(5) { height: 12px; animation-delay: 0.05s; }
.eq-bar:nth-child(6) { height: 16px; animation-delay: 0.25s; }
.eq-bar:nth-child(7) { height: 9px; animation-delay: 0.1s; }

@keyframes eq {
  0% { transform: scaleY(0.3); }
  100% { transform: scaleY(1); }
}
```

## 성능 최적화 팁

### 1. CSS `transform` 사용

`left`, `top` 속성 대신 `transform: translate()`을 사용하면 GPU 가속을 받아 부드럽게 애니메이션됩니다.

```css
/* ❌ 성능 나쁨 */
.pupil { left: 20px; top: 30px; }

/* ✅ 성능 좋음 */
.pupil { transform: translate(20px, 30px); }
```

### 2. `requestAnimationFrame` 대신 이벤트 쓰로틀링

마우스 이벤트는 매우 빠르게 발생하므로, 필요 이상으로 계산하지 않도록 최적화할 수 있습니다. (이 프로젝트에서는 단순함을 위해 생략했지만, 프로덕션에서는 권장)

```javascript
let ticking = false;
document.addEventListener('mousemove', (e) => {
  if (!ticking) {
    requestAnimationFrame(() => {
      updatePupils(e.clientX, e.clientY);
      ticking = false;
    });
    ticking = true;
  }
});
```

### 3. `will-change` 속성

자주 변경되는 속성에 `will-change`를 지정하면 브라우저가 미리 최적화합니다.

```css
.pupil {
  will-change: transform;
}
```

## 확장 아이디어

### 1. 음성 인식 연동

Web Speech API로 음성 입력을 받아서, 말할 때 입이 벌어지는 애니메이션을 추가할 수 있습니다.

```javascript
const recognition = new webkitSpeechRecognition();
recognition.onstart = () => {
  mouth.classList.add('talking');
  eq.classList.add('active');
};
recognition.onend = () => {
  mouth.classList.remove('talking');
  eq.classList.remove('active');
};
recognition.start();
```

### 2. 감정 상태 시스템

사용자 입력(채팅 메시지 감성 분석)에 따라 표정을 바꿀 수 있습니다.
- 긍정 메시지 → 행복한 표정
- 부정 메시지 → 걱정스러운 표정

### 3. 다중 캐릭터

여러 AI 에이전트가 있다면, 각각 다른 색상과 스타일의 얼굴을 만들어서 구분할 수 있습니다.

### 4. Three.js 3D 버전

CSS 2D 대신 Three.js로 3D 얼굴을 만들면 더 입체감 있는 캐릭터를 구현할 수 있습니다.

## 얻은 교훈

### 1. CSS만으로도 충분히 생동감 있다

복잡한 WebGL이나 Canvas 없이도, CSS 애니메이션과 JavaScript 이벤트만으로 충분히 인터랙티브한 캐릭터를 만들 수 있습니다.

### 2. 작은 디테일이 몰입감을 만든다

- 자동 깜빡임
- 시간대별 표정 변화
- 랜덤 행동

이런 **예측 불가능한 작은 행동들**이 캐릭터를 살아있는 것처럼 느끼게 만듭니다.

### 3. 애니메이션 타이밍이 중요하다

- 깜빡임: 4초 주기 (너무 자주 깜빡이면 산만함)
- 윙크: 0.5초 (자연스러운 속도)
- 말풍선: 2초 지속 (읽기 충분한 시간)

이런 타이밍은 실제로 테스트해보며 조정했습니다.

### 4. 성능은 처음부터 고려하자

처음엔 `setInterval`로 매 프레임 눈동자를 업데이트했는데, CPU 사용량이 높아졌습니다. `mousemove` 이벤트 기반으로 바꾸니 훨씬 가벼워졌죠.

## 마치며

AI 비서에게 얼굴을 만들어주는 작업은 생각보다 재미있었습니다. 단순한 텍스트 인터페이스보다 훨씬 친근하게 느껴지고, 사용자 경험도 개선되었습니다.

이 프로젝트는 순수 HTML/CSS/JS만 사용했기 때문에, 누구나 쉽게 따라 할 수 있습니다. 여러분의 AI 에이전트에도 얼굴을 만들어주세요!

코드 전체는 약 300줄 정도로, 복잡하지 않습니다. 위 코드 조각들을 조합하면 바로 작동하는 캐릭터를 만들 수 있습니다.

**다음 프로젝트**: AI 에이전트가 실제로 말할 때 입 모양이 동기화되는 립싱크 기능을 추가해볼 계획입니다. Web Speech API와 연동하면 가능할 것 같습니다!

## 참고 자료
- [CSS Animation - MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Animations)
- [JavaScript Mouse Events - MDN](https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent)
- [CSS Transform Performance - web.dev](https://web.dev/animations-guide/)
- [Web Speech API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
