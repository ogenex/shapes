import { createEngine, prepareAttempt, getResume, clearResume } from './quiz-engine.js';

const elementIds = [
    'questionText', 'currentQ', 'totalQ', 'scoreDisplay', 'visualWrapper',
    'optionsContainer', 'feedbackContainer', 'nextButton', 'testScreen',
    'resultsScreen', 'percentageDisplay', 'correctCount', 'totalCount',
    'feedbackMessage', 'reviewSection', 'reviewToggle', 'reviewList',
    'historyList', 'restartButton', 'printButton',
];

function collectElements() {
    const elements = {};
    elementIds.forEach(id => (elements[id] = document.getElementById(id)));
    return elements;
}

async function init() {
    const topicId = new URLSearchParams(location.search).get('topic');
    const loadingState = document.getElementById('loadingState');
    const errorState = document.getElementById('errorState');
    const quizRoot = document.getElementById('quizRoot');

    if (!topicId) {
        loadingState.classList.add('hidden');
        errorState.classList.remove('hidden');
        return;
    }

    let topic;
    try {
        const response = await fetch('data/topics/' + encodeURIComponent(topicId) + '.json');
        if (!response.ok) throw new Error('not found');
        topic = await response.json();
    } catch (e) {
        loadingState.classList.add('hidden');
        errorState.classList.remove('hidden');
        return;
    }

    loadingState.classList.add('hidden');
    quizRoot.classList.remove('hidden');
    document.getElementById('topicTitle').textContent = topic.title;
    document.title = topic.title + ' — Year 7 NAPLAN Maths Practice';

    const engine = createEngine({
        topicId,
        questions: prepareAttempt(topic.questions),
        elements: collectElements(),
    });

    const resume = getResume(topicId);
    if (resume && resume.currentIndex < resume.questions.length) {
        const resumeBanner = document.getElementById('resumeBanner');
        resumeBanner.classList.remove('hidden');
        document.getElementById('resumeText').textContent =
            'You have an attempt in progress — question ' + (resume.currentIndex + 1) + ' of ' + resume.questions.length + '.';
        document.getElementById('resumeButton').onclick = () => {
            resumeBanner.classList.add('hidden');
            engine.start(resume);
        };
        document.getElementById('discardResumeButton').onclick = () => {
            clearResume(topicId);
            resumeBanner.classList.add('hidden');
            engine.start();
        };
    } else {
        engine.start();
    }
}

init();
