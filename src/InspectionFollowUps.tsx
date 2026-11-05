import { gradeNames, sections, type Inspection } from './inspection-model';

export function InspectionFollowUps({answers, onJump}: {
    answers: Inspection['answers'];
    onJump: (section: number, item: number) => void;
}) {
    const items = sections.flatMap((section, sectionIndex) =>
        section.items.flatMap((label, itemIndex) => {
            const grade = answers[`${sectionIndex}-${itemIndex}`];
            return grade === 'B' || grade === 'C'
                ? [{label, grade, sectionIndex, itemIndex}]
                : [];
        })
    );
    if (!items.length) return null;

    return <section className="inspection-follow-ups" aria-label="조치가 필요한 항목">
        <h3>조치가 필요한 항목 {items.length}개</h3>
        <ul>
            {items.map(({label,grade,sectionIndex,itemIndex}) =>
                <li key={`${sectionIndex}-${itemIndex}`}>
                    <button type="button" className="text-button" onClick={()=>onJump(sectionIndex,itemIndex)}>
                        <small>{sections[sectionIndex].title} · {grade} {gradeNames[grade]}</small>
                        <span>{label}</span>
                    </button>
                </li>
            )}
        </ul>
    </section>;
}
