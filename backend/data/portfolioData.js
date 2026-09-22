'use strict';

// 공개 API용 어댑터. 저장소를 바꿔도 이 응답 모양은 유지한다.
const projectStore = require('./projectStore');

// 관리자 전용 필드(status, createdAt 등)는 공개 응답에서 제외한다.
function toPublicProject(project) {
  return {
    id: project.id,
    category: project.category,
    title: project.title,
    description: project.description,
    role: project.role,
    result: project.result,
    date: project.date,
    teamSize: project.teamSize,
    notes: project.notes,
    linkUrl: project.linkUrl,
    linkLabel: project.linkLabel,
  };
}

async function getPortfolioData() {
  const published = await projectStore.listPublished();
  return { projects: published.map(toPublicProject) };
}

module.exports = { getPortfolioData };
