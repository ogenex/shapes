const STORAGE_KEY = 'naplanQuiz:v1';
const HISTORY_LIMIT = 10;

function readStore() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
        return {};
    }
}

function writeStore(store) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
        // localStorage unavailable (private browsing, quota) - progress just won't persist
    }
}

function getTopicRecord(topicId) {
    const store = readStore();
    return store[topicId] || { resume: null, history: [] };
}

function saveTopicRecord(topicId, record) {
    const store = readStore();
    store[topicId] = record;
    writeStore(store);
}

export function getHistory(topicId) {
    return getTopicRecord(topicId).history;
}

export function getResume(topicId) {
    return getTopicRecord(topicId).resume;
}

export function clearResume(topicId) {
    const record = getTopicRecord(topicId);
    record.resume = null;
    saveTopicRecord(topicId, record);
}

function shuffle(array) {
    const result = array.slice();
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function shuffleQuestion(question) {
    const optionOrder = shuffle(question.options.map((text, index) => ({ text, index })));
    const correct = optionOrder.findIndex(o => o.index === question.correct);
    const shuffled = {
        question: question.question,
        options: optionOrder.map(o => o.text),
        correct,
        explanation: question.explanation,
    };
    if (question.visual) shuffled.visual = question.visual;
    return shuffled;
}

export function prepareAttempt(questions) {
    return shuffle(questions).map(shuffleQuestion);
}

export function recordCompletedAttempt(topicId, score, total) {
    const record = getTopicRecord(topicId);
    record.resume = null;
    record.history = [{ date: new Date().toISOString(), score, total }]
        .concat(record.history)
        .slice(0, HISTORY_LIMIT);
    saveTopicRecord(topicId, record);
}

export function saveResumeState(topicId, state) {
    const record = getTopicRecord(topicId);
    record.resume = state;
    saveTopicRecord(topicId, record);
}

export function createEngine({ topicId, questions, elements }) {
    const state = {
        questions,
        currentIndex: 0,
        score: 0,
        missed: [],
        answered: false,
    };

    function el(name) {
        return elements[name];
    }

    function persist() {
        saveResumeState(topicId, {
            questions: state.questions,
            currentIndex: state.currentIndex,
            score: state.score,
            missed: state.missed,
        });
    }

    function loadQuestion() {
        const question = state.questions[state.currentIndex];
        el('questionText').textContent = question.question;
        el('currentQ').textContent = state.currentIndex + 1;
        el('totalQ').textContent = state.questions.length;
        el('scoreDisplay').textContent = state.score;

        const visualWrapper = el('visualWrapper');
        if (question.visual) {
            visualWrapper.innerHTML = question.visual;
            visualWrapper.classList.remove('hidden');
        } else {
            visualWrapper.innerHTML = '';
            visualWrapper.classList.add('hidden');
        }

        const optionsContainer = el('optionsContainer');
        optionsContainer.innerHTML = '';
        question.options.forEach((option, index) => {
            const button = document.createElement('button');
            button.className = 'option';
            button.textContent = String.fromCharCode(65 + index) + '. ' + option;
            button.onclick = () => selectAnswer(index);
            optionsContainer.appendChild(button);
        });

        el('feedbackContainer').classList.add('hidden');
        el('nextButton').classList.add('hidden');
        state.answered = false;

        persist();
    }

    function selectAnswer(index) {
        if (state.answered) return;
        state.answered = true;

        const question = state.questions[state.currentIndex];
        const options = el('optionsContainer').querySelectorAll('.option');
        options.forEach(btn => (btn.disabled = true));

        const isCorrect = index === question.correct;
        if (isCorrect) {
            state.score++;
        } else {
            state.missed.push({
                question: question.question,
                visual: question.visual,
                options: question.options,
                chosenIndex: index,
                correctIndex: question.correct,
                explanation: question.explanation,
            });
        }

        options[index].classList.add(isCorrect ? 'correct' : 'incorrect', 'selected');
        if (!isCorrect) {
            options[question.correct].classList.add('correct');
        }

        el('scoreDisplay').textContent = state.score;

        const feedbackContainer = el('feedbackContainer');
        feedbackContainer.innerHTML =
            '<div class="feedback ' + (isCorrect ? 'correct' : 'incorrect') + '">' +
            '<div class="feedback-title">' + (isCorrect ? '✓ Correct!' : '✗ Not quite') + '</div>' +
            '<div>' + question.explanation + '</div>' +
            '</div>';
        feedbackContainer.classList.remove('hidden');

        el('nextButton').classList.remove('hidden');

        persist();
    }

    function nextQuestion() {
        if (state.currentIndex < state.questions.length - 1) {
            state.currentIndex++;
            loadQuestion();
        } else {
            showResults();
        }
    }

    function showResults() {
        el('testScreen').classList.add('hidden');
        el('resultsScreen').classList.remove('hidden');

        const total = state.questions.length;
        const percentage = Math.round((state.score / total) * 100);
        el('percentageDisplay').textContent = percentage + '%';
        el('correctCount').textContent = state.score;
        el('totalCount').textContent = total;

        let message = '';
        if (percentage >= 80) {
            message = 'Excellent work! You\'ve demonstrated strong understanding of this topic.';
        } else if (percentage >= 60) {
            message = 'Good effort! Review the questions you missed to strengthen those concepts.';
        } else {
            message = 'Keep practicing! Focus on the areas where you found the questions challenging.';
        }
        el('feedbackMessage').textContent = message;

        renderMissed();
        recordCompletedAttempt(topicId, state.score, total);
        renderHistory();
    }

    function renderMissed() {
        const reviewSection = el('reviewSection');
        const reviewToggle = el('reviewToggle');
        const reviewList = el('reviewList');

        if (state.missed.length === 0) {
            reviewSection.classList.add('hidden');
            return;
        }

        reviewSection.classList.remove('hidden');
        reviewToggle.textContent = 'Review missed questions (' + state.missed.length + ')';
        reviewList.innerHTML = state.missed
            .map(m => {
                const visualHtml = m.visual ? '<div class="visual-container">' + m.visual + '</div>' : '';
                return (
                    '<div class="review-item">' +
                    '<div class="review-question">' + m.question + '</div>' +
                    visualHtml +
                    '<div class="review-answer wrong">Your answer: ' + m.options[m.chosenIndex] + '</div>' +
                    '<div class="review-answer right">Correct answer: ' + m.options[m.correctIndex] + '</div>' +
                    '<div class="review-explanation">' + m.explanation + '</div>' +
                    '</div>'
                );
            })
            .join('');
        reviewList.classList.add('hidden');
    }

    function renderHistory() {
        const record = getTopicRecord(topicId);
        const historyList = el('historyList');
        const previous = record.history.slice(1, 4);
        if (previous.length === 0) {
            historyList.innerHTML = '';
            return;
        }
        historyList.innerHTML =
            '<div class="history-label">Previous attempts</div>' +
            previous
                .map(h => {
                    const pct = Math.round((h.score / h.total) * 100);
                    const date = new Date(h.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                    return '<div class="history-item">' + date + ' — ' + pct + '% (' + h.score + '/' + h.total + ')</div>';
                })
                .join('');
    }

    function restartTest() {
        state.questions = prepareAttempt(state.questions);
        state.currentIndex = 0;
        state.score = 0;
        state.missed = [];
        state.answered = false;

        el('testScreen').classList.remove('hidden');
        el('resultsScreen').classList.add('hidden');

        loadQuestion();
    }

    el('nextButton').onclick = nextQuestion;
    el('restartButton').onclick = restartTest;
    el('reviewToggle').onclick = () => el('reviewList').classList.toggle('hidden');
    el('printButton').onclick = () => window.print();

    return {
        start(resumeState) {
            if (resumeState) {
                state.questions = resumeState.questions;
                state.currentIndex = resumeState.currentIndex;
                state.score = resumeState.score;
                state.missed = resumeState.missed;
            }
            el('testScreen').classList.remove('hidden');
            loadQuestion();
        },
    };
}
